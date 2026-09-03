'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { consultarProcesso, JuditError, juditConfigurada } from '@/lib/judit/client';
import { extrairRedFlags } from '@/lib/judit/red-flags';
import { extrairMetadadosProspeccao } from '@/lib/judit/extract';

const BATCH_MAX = 50;
const DELAY_MS = 800; // throttle entre chamadas pra não estourar rate limit

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Roda Judit em batch pra até 50 prospecções pendentes.
 * Sequencial (não paralelo) pra respeitar rate limit da Judit.
 *
 * Pra cada item:
 * 1. Chama consultarProcesso
 * 2. Salva payload bruto em dd_judit_consultas
 * 3. Extrai metadados (nome do credor, advogado, OAB) + red flags
 * 4. Atualiza prospeccao_precatorios: judit_status, enriquecido_em, campos extraídos, status='enriquecido'
 *
 * Retorna resumo: ok, not_found, error.
 */
export async function enriquecerLoteJudit(
  ids: string[],
): Promise<
  | { ok: true; data: { ok: number; not_found: number; error: number } }
  | { ok: false; error: string }
> {
  if (!juditConfigurada()) {
    return {
      ok: false,
      error: 'Judit não configurada. Adicione JUDIT_API_KEY no .env.local.',
    };
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, error: 'Nenhum item selecionado.' };
  }
  if (ids.length > BATCH_MAX) {
    return { ok: false, error: `Máximo ${BATCH_MAX} por batch (evita estourar rate limit).` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  // Busca as prospecções pendentes
  const { data: pendentes, error: fetchErr } = await supabase
    .from('prospeccao_precatorios')
    .select('id, numero_processo, judit_status')
    .in('id', ids);

  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!pendentes || pendentes.length === 0) {
    return { ok: false, error: 'Prospecções não encontradas.' };
  }

  const resumo = { ok: 0, not_found: 0, error: 0 };

  for (const p of pendentes) {
    let payload;
    let erroMsg: string | null = null;
    let status: 'ok' | 'not_found' | 'error' = 'ok';

    try {
      payload = await consultarProcesso(p.numero_processo);
    } catch (err) {
      if (err instanceof JuditError) {
        erroMsg = err.message;
        status = err.status === 404 ? 'not_found' : 'error';
        payload = { erro: err.message };
      } else {
        erroMsg = err instanceof Error ? err.message : 'Erro desconhecido';
        status = 'error';
        payload = { erro: erroMsg };
      }
    }

    // Salva consulta (operacao_id null aqui — ainda é prospecção, sem op vinculada)
    const { data: consulta } = await supabase
      .from('dd_judit_consultas')
      .insert({
        operacao_id: null,
        numero_processo: p.numero_processo,
        tipo_consulta: 'processo',
        payload_bruto: payload,
        status,
        erro_msg: erroMsg,
        criado_por: user.id,
      })
      .select('id')
      .single();

    // Se salvar consulta falhou (ex: FK), ainda atualiza prospeccao com o resultado
    // (não é fatal — histórico é bonus)
    const consultaId = consulta?.id ?? null;

    if (status === 'ok') {
      const meta = extrairMetadadosProspeccao(payload);
      const redFlags = extrairRedFlags(payload);
      await supabase
        .from('prospeccao_precatorios')
        .update({
          judit_status: 'ok',
          judit_ultima_consulta_id: consultaId,
          judit_enriquecido_em: new Date().toISOString(),
          cedente_nome_provavel: meta.cedenteNome,
          cedente_cpf_provavel: meta.cedenteCpf,
          advogado_nome: meta.advogadoNome,
          advogado_oab: meta.advogadoOab,
          red_flags: redFlags,
          status: 'enriquecido',
        })
        .eq('id', p.id);
      resumo.ok++;
    } else {
      await supabase
        .from('prospeccao_precatorios')
        .update({
          judit_status: status,
          judit_ultima_consulta_id: consultaId,
          judit_enriquecido_em: new Date().toISOString(),
        })
        .eq('id', p.id);
      resumo[status]++;
    }

    // Throttle
    if (pendentes.indexOf(p) < pendentes.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  revalidatePath('/admin/prospeccao');
  return { ok: true, data: resumo };
}
