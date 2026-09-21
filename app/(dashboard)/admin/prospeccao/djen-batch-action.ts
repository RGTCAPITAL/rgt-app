'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { exigirPerfil } from '@/lib/auth/roles';
import { buscarPorCnj } from '@/lib/djen/client';
import { paraLinhaBanco } from '@/lib/djen/mappers';
import { DjenError, type Publicacao, type RedFlag } from '@/lib/djen/types';

const BATCH_MAX = 50;

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
 *   1. `buscarPorCnj` no DJEN, pega até 20 publicações mais recentes
 *   2. Persiste cada uma em `djen_publicacoes` (upsert por id)
 *   3. Consolida: pega o credor + advogado + red flags da mais recente e
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
      error: `Máximo ${BATCH_MAX} por batch (evita saturar rate limit da API pública).`,
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

  for (const p of pendentes) {
    let publicacoes: Publicacao[] = [];
    let erroMsg: string | null = null;

    try {
      publicacoes = await buscarPorCnj(p.numero_processo, { limite: 20 });
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

    // Consolida pra fila de prospecção: pega o SINAL mais forte da publicação
    // mais recente, mas juntando red flags de TODAS as publicações do processo.
    // Uma cessão averbada 6 meses atrás continua contando hoje.
    const maisRecente = publicacoes[0]!;
    const todasRedFlags: RedFlag[] = publicacoes.flatMap((pub) => pub.redFlags);
    const cedenteReal = maisRecente.destinatarios.find((d) => d.polo === 'A' && !d.mascarado);
    const primeiroAdv = maisRecente.advogados[0];

    // `prospeccao_precatorios.red_flags` é text[] (herdado da Judit, que usava
    // enum simples). Guardamos só os códigos aqui — o detalhe completo (trecho,
    // categoria, contexto) fica em `djen_publicacoes.red_flags` (jsonb),
    // consultado no detalhe da operação quando o broker precisar.
    const codigosRedFlags = codigosDedup(todasRedFlags);

    await supabase
      .from('prospeccao_precatorios')
      .update({
        judit_status: 'ok',
        judit_enriquecido_em: new Date().toISOString(),
        cedente_nome_provavel: cedenteReal?.nome ?? null,
        // DJEN não devolve CPF em campo algum — deixa vazio pra ficar honesto
        cedente_cpf_provavel: null,
        advogado_nome: primeiroAdv?.nome ?? null,
        advogado_oab: primeiroAdv ? `${primeiroAdv.oab}/${primeiroAdv.uf}` : null,
        red_flags: codigosRedFlags,
        status: 'enriquecido',
      })
      .eq('id', p.id);
    resumo.ok++;
  }

  revalidatePath('/admin/prospeccao');
  return { ok: true, data: resumo };
}

/**
 * Deduplica red flags por código e devolve só os códigos, na ordem em que
 * apareceram. Se o mesmo padrão bateu 5x em 3 publicações, entra uma vez.
 * O detalhe completo (trecho, contexto) fica em `djen_publicacoes.red_flags`.
 */
function codigosDedup(flags: RedFlag[]): string[] {
  const vistos = new Set<string>();
  const codigos: string[] = [];
  for (const f of flags) {
    if (vistos.has(f.codigo)) continue;
    vistos.add(f.codigo);
    codigos.push(f.codigo);
  }
  return codigos;
}
