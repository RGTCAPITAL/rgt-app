'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { consultarProcesso, JuditError, juditConfigurada } from '@/lib/judit/client';
import { extrairRedFlags } from '@/lib/judit/red-flags';
import type { ProcessoJudit, ResultadoConsultaJudit } from '@/lib/judit/types';

/**
 * Server action que roda uma consulta Judit pra uma operação.
 *
 * Fluxo:
 * 1. Valida perfil (admin/gestao/juridico)
 * 2. Chama Judit API
 * 3. Extrai red flags
 * 4. Salva em dd_judit_consultas (trigger atualiza cache em operacoes)
 * 5. Atualiza dd_judit_red_flags separadamente (lógica de app, não trigger)
 * 6. Revalida a página de detalhe
 *
 * Aviso: se JUDIT_API_KEY não estiver setada, retorna erro amigável
 * sem quebrar o app.
 */
export async function rodarConsultaJudit(operacaoId: string): Promise<ResultadoConsultaJudit> {
  if (!juditConfigurada()) {
    return {
      ok: false,
      erro: 'Judit não configurada. Adicione JUDIT_API_KEY no .env.local.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, erro: 'Sessão expirada.' };

  // Busca operação pra pegar CNJ + validar RLS
  const { data: op } = await supabase
    .from('operacoes')
    .select('id, numero_processo')
    .eq('id', operacaoId)
    .maybeSingle();
  if (!op) return { ok: false, erro: 'Operação não encontrada ou sem permissão.' };

  // Chama Judit
  let payload;
  let erroMsg: string | null = null;
  let status: 'ok' | 'not_found' | 'error' = 'ok';
  try {
    payload = await consultarProcesso(op.numero_processo);
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

  // Salva consulta (trigger atualiza cache em operacoes)
  const { data: consulta, error: insertErr } = await supabase
    .from('dd_judit_consultas')
    .insert({
      operacao_id: operacaoId,
      numero_processo: op.numero_processo,
      tipo_consulta: 'processo',
      payload_bruto: payload,
      status,
      erro_msg: erroMsg,
      criado_por: user.id,
      // credito_gasto: preencher quando confirmar formato retornado pela API
    })
    .select('id')
    .single();

  if (insertErr) return { ok: false, erro: insertErr.message };

  if (status !== 'ok') {
    return { ok: false, erro: erroMsg ?? 'Erro ao consultar Judit' };
  }

  // Extrai red flags e persiste em operacoes
  const redFlags = extrairRedFlags(payload);
  await supabase.from('operacoes').update({ dd_judit_red_flags: redFlags }).eq('id', operacaoId);

  revalidatePath(`/operacoes/${operacaoId}`);
  return { ok: true, consultaId: consulta.id, redFlags, dados: payload as ProcessoJudit };
}
