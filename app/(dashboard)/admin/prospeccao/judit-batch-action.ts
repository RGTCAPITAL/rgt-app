'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { consultarProcesso, JuditError, juditConfigurada } from '@/lib/judit/client';
import { extrairRedFlags } from '@/lib/judit/red-flags';
import { extrairMetadadosProspeccao } from '@/lib/judit/extract';
import { exigirPerfil } from '@/lib/auth/roles';

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
  // Gate primeiro: quem não pode disparar o batch não precisa nem saber se a
  // integração está configurada. Cada consulta Judit custa crédito real, então
  // a autorização vem antes de qualquer trabalho.
  const auth = await exigirPerfil(['admin', 'gestao', 'juridico']);
  if (!auth.ok) return { ok: false, error: auth.error };
  const user = { id: auth.userId };

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

  for (let i = 0; i < pendentes.length; i++) {
    const p = pendentes[i]!;

    // Throttle no topo do loop: garante o intervalo entre chamadas Judit mesmo
    // quando uma iteração aborta cedo (a chamada paga já aconteceu de qualquer jeito).
    if (i > 0) await sleep(DELAY_MS);

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
    const { data: consulta, error: consultaErr } = await supabase
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

    // Sem trilha de auditoria não gravamos dado derivado: a prospecção passaria a
    // exibir cedente/advogado "da Judit" sem nenhuma consulta registrada por trás.
    if (consultaErr) {
      resumo.error++;
      await supabase
        .from('prospeccao_precatorios')
        .update({ judit_status: 'error' })
        .eq('id', p.id);
      continue;
    }

    const consultaId = consulta.id;

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
  }

  revalidatePath('/admin/prospeccao');
  return { ok: true, data: resumo };
}
