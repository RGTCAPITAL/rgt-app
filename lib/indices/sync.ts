/**
 * Sincronização das séries de índices pro banco.
 *
 * Regra central: **só persistimos meses FECHADOS**. A série 4390 (Selic) devolve
 * o mês corrente ainda acumulando — em 09/09/2026 ela retornava set/2026 = 0,26
 * (só os dias decorridos) contra ago/2026 = 1,09 (mês inteiro). Gravar o mês
 * corrente faria a correção sair a menor, e o erro ficaria congelado no snapshot.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buscarSerie } from './bcb';
import { buscarNumeroIndiceIpca } from './ibge';
import { DEF_SERIES, IBGE_IPCA, SERIES, type Serie } from './series';

export type ResultadoSync = {
  serie: Serie;
  gravados: number;
  ultimaCompetencia: string | null;
  erro?: string;
};

/** Primeiro dia do mês corrente, ISO. Competências >= isso ainda não fecharam. */
function primeiroDiaMesCorrente(hoje = new Date()): string {
  const ano = hoje.getUTCFullYear();
  const mes = String(hoje.getUTCMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}-01`;
}

/**
 * Sincroniza uma série. Busca do início configurado (ou de `desdeIso`) até hoje,
 * descarta o mês em curso e grava o resto.
 *
 * Upsert por (serie, competencia): reexecutar é seguro. Valores revisados pela
 * fonte são atualizados, e `coletado_em` registra quando.
 */
export async function sincronizarSerie(
  supabase: SupabaseClient,
  serie: Serie,
  desdeIso?: string,
  hoje = new Date(),
): Promise<ResultadoSync> {
  const def = DEF_SERIES[serie];
  const inicio = desdeIso ?? def.inicio;
  const fim = hoje.toISOString().slice(0, 10);
  const corteMesAberto = primeiroDiaMesCorrente(hoje);

  try {
    const pontos = await buscarSerie(serie, inicio, fim);

    // Descarta o mês que ainda não fechou
    const fechados = pontos.filter((p) => p.competencia < corteMesAberto);
    if (fechados.length === 0) {
      return { serie, gravados: 0, ultimaCompetencia: null };
    }

    // Pro IPCA, enriquecemos com o número-índice do IBGE (fator = I_f / I_i)
    let numerosIndice = new Map<string, number>();
    if (serie === 'ipca') {
      try {
        const pontosIbge = await buscarNumeroIndiceIpca(fechados[0]!.competencia, fim);
        numerosIndice = new Map(pontosIbge.map((p) => [p.competencia, p.numeroIndice]));
      } catch {
        // Número-índice é otimização, não requisito: sem ele o fator ainda sai
        // encadeando as variações. Não derruba a sincronização.
      }
    }

    const linhas = fechados.map((p) => ({
      serie,
      competencia: p.competencia,
      variacao_pct: p.valor,
      numero_indice: numerosIndice.get(p.competencia) ?? null,
      fonte: numerosIndice.has(p.competencia) ? `${def.fonte}+${IBGE_IPCA.fonte}` : def.fonte,
      coletado_em: hoje.toISOString(),
    }));

    const { error } = await supabase
      .from('indices_economicos')
      .upsert(linhas, { onConflict: 'serie,competencia' });

    if (error) return { serie, gravados: 0, ultimaCompetencia: null, erro: error.message };

    return {
      serie,
      gravados: linhas.length,
      ultimaCompetencia: linhas[linhas.length - 1]!.competencia,
    };
  } catch (err) {
    return {
      serie,
      gravados: 0,
      ultimaCompetencia: null,
      erro: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Sincroniza todas as séries. Sequencial de propósito: são 6 chamadas a uma API
 * pública sem SLA — não vale a pena martelar em paralelo pra economizar segundos
 * num job que roda 1x por mês.
 */
export async function sincronizarTodas(
  supabase: SupabaseClient,
  desdeIso?: string,
  hoje = new Date(),
): Promise<ResultadoSync[]> {
  const resultados: ResultadoSync[] = [];
  for (const serie of SERIES) {
    resultados.push(await sincronizarSerie(supabase, serie, desdeIso, hoje));
  }
  return resultados;
}
