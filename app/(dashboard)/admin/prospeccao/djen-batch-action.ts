'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { exigirPerfil } from '@/lib/auth/roles';
import { buscarPorCnj } from '@/lib/djen/client';
import { consolidarProcesso, peritosCitados } from '@/lib/djen/consolidar';
import { paraLinhaBanco } from '@/lib/djen/mappers';
import { DjenError, type Publicacao } from '@/lib/djen/types';

// 100 leva ~5-6 min no rate limiter (3.3s/request serial). DJEN é grátis e
// permite 20 req/min; o gargalo real é o timeout do server action, não a API.
const BATCH_MAX = 100;

/**
 * Enriquece a fila de prospecção via DJEN (API pública do CNJ, gratuita).
 *
 * Substitui o batch da Judit no caso de uso principal — mesmos campos
 * preenchidos em `prospeccao_precatorios`, mesmo shape de red flags. A
 * diferença é que DJEN é fluxo (só processos com publicação desde set/2024),
 * então nem sempre tem retorno. Quando não tem, a linha vira `not_found`
 * e o broker sabe que precisa buscar por outro caminho.
 *
 * Pra cada item:
 *   1. `buscarPorCnj` no DJEN, pega até 100 publicações mais recentes — o
 *      máximo de 1 página, então continua sendo 1 request por processo. Com 20,
 *      39 dos 127 processos do TRT19 batiam no teto (23/10): o histórico vinha
 *      cortado justo onde a consolidação busca cabeçalho e red flag antiga.
 *   2. Persiste cada uma em `djen_publicacoes` (upsert por id)
 *   3. Consolida TODAS (ver `lib/djen/consolidar.ts`): credor pelo cabeçalho
 *      PJe, advogado do lado do credor, red flags de todas as publicações — e
 *      escreve em `prospeccao_precatorios`
 *
 * Não gasta dinheiro por consulta — o gate de perfil existe pra manter
 * consistência com o batch da Judit (mesmo público) e evitar broker
 * disparando ingestão sem saber.
 */
export async function enriquecerLoteDjen(
  ids: string[],
): Promise<
  | { ok: true; data: { ok: number; not_found: number; error: number } }
  | { ok: false; error: string }
> {
  const auth = await exigirPerfil(['admin', 'gestao', 'juridico']);
  if (!auth.ok) return { ok: false, error: auth.error };

  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, error: 'Nenhum item selecionado.' };
  }
  if (ids.length > BATCH_MAX) {
    return {
      ok: false,
      error: `Máximo ${BATCH_MAX} por batch — um lote grande leva ~5-6 min. Divide em vezes menores.`,
    };
  }

  const supabase = await createClient();

  const { data: pendentes, error: fetchErr } = await supabase
    .from('prospeccao_precatorios')
    .select('id, numero_processo')
    .in('id', ids);

  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!pendentes?.length) {
    return { ok: false, error: 'Prospecções não encontradas.' };
  }

  const resumo = { ok: 0, not_found: 0, error: 0 };
  // O calculista do TRT19 é polo A em todo processo onde fez a conta, mas só
  // alguns textos dizem "perito". Acumula quem já apareceu como perito no lote
  // pra não virar credor nos processos seguintes — é melhor-esforço: depende
  // da ordem, e o processo onde ele é citado continua se protegendo sozinho.
  const peritosDoLote = new Set<string>();

  for (const p of pendentes) {
    let publicacoes: Publicacao[] = [];
    let erroMsg: string | null = null;

    try {
      publicacoes = await buscarPorCnj(p.numero_processo, { limite: 100 });
    } catch (e) {
      erroMsg =
        e instanceof DjenError
          ? `[${e.codigo}] ${e.message}`
          : e instanceof Error
            ? e.message
            : 'Erro desconhecido';
    }

    if (erroMsg) {
      resumo.error++;
      await supabase
        .from('prospeccao_precatorios')
        .update({
          judit_status: 'error',
          judit_enriquecido_em: new Date().toISOString(),
        })
        .eq('id', p.id);
      continue;
    }

    if (publicacoes.length === 0) {
      resumo.not_found++;
      await supabase
        .from('prospeccao_precatorios')
        .update({
          judit_status: 'not_found',
          judit_enriquecido_em: new Date().toISOString(),
        })
        .eq('id', p.id);
      continue;
    }

    // Persiste todas as publicações em djen_publicacoes (upsert por id).
    // A trigger `djen_derivar_campos` popula credor_nome/advogado_oab pra
    // queries rápidas depois. Fallback pra hash em caso de colisão.
    const linhas = publicacoes.map(paraLinhaBanco);
    const { error: upsertErr } = await supabase
      .from('djen_publicacoes')
      .upsert(linhas, { onConflict: 'id', ignoreDuplicates: false });

    if (upsertErr) {
      resumo.error++;
      await supabase
        .from('prospeccao_precatorios')
        .update({
          judit_status: 'error',
          judit_enriquecido_em: new Date().toISOString(),
        })
        .eq('id', p.id);
      continue;
    }

    // Consolida pra fila de prospecção olhando TODAS as publicações do
    // processo, não só a mais recente: o DJEN lista destinatários e advogados
    // em ordem alfabética, então "1º do polo A" e "advogados[0]" pegavam ente,
    // perito ou procurador do devedor. Advogado sem evidência no texto fica
    // null de propósito — melhor vazio que o telefone do outro lado.
    for (const nome of peritosCitados(publicacoes)) peritosDoLote.add(nome);
    const { credor, advogado, redFlags } = consolidarProcesso(publicacoes, {
      peritos: peritosDoLote,
    });

    // `prospeccao_precatorios.red_flags` é text[] (herdado da Judit, que usava
    // enum simples). Guardamos só os códigos aqui — o detalhe completo (trecho,
    // categoria, contexto) fica em `djen_publicacoes.red_flags` (jsonb),
    // consultado no detalhe da operação quando o broker precisar.
    await supabase
      .from('prospeccao_precatorios')
      .update({
        judit_status: 'ok',
        judit_enriquecido_em: new Date().toISOString(),
        cedente_nome_provavel: credor.nome,
        // DJEN não devolve CPF em campo algum — deixa vazio pra ficar honesto
        cedente_cpf_provavel: null,
        advogado_nome: advogado?.nome ?? null,
        advogado_oab: advogado?.oab ?? null,
        red_flags: redFlags,
        status: 'enriquecido',
      })
      .eq('id', p.id);
    resumo.ok++;
  }

  revalidatePath('/admin/prospeccao');
  return { ok: true, data: resumo };
}
