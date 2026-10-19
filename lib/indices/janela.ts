/**
 * Quanto da série pedir ao BCB em cada execução.
 *
 * Antes do cron isso não existia: `sincronizarTodas` era chamada sem intervalo e
 * rebaixava a série inteira — IPCA desde 1980, INPC desde 1979. Num clique
 * manual por mês isso é inofensivo. Num job diário são 2.529 upserts por dia
 * reescrevendo `coletado_em` em linhas de 1980, o que contraria a semântica de
 * snapshot que a migration 021 declara, e amplia o raio do bug do
 * `numero_indice` de ~3 linhas pra 561.
 *
 * DUAS REGRAS QUE SÃO DE CONSTRUÇÃO, NÃO DE OTIMIZAÇÃO:
 *
 * 1. **A âncora é o banco, nunca o relógio.** Uma janela do tipo "últimos N
 *    meses a partir de hoje" não cicatriza buraco deixado por um cron parado
 *    cinco semanas. E buraco não falha na hora: ele faz `calcularFator` RECUSAR
 *    todo crédito com data-base anterior a ele, semanas depois, sem ninguém
 *    ligar as duas coisas.
 *
 * 2. **A sobreposição é obrigatória.** Pedir a partir da competência seguinte à
 *    última produz intervalo vazio na fonte, e intervalo vazio não devolve lista
 *    vazia — devolve erro. Sondado em 19/10/2026 com `dataInicial=01/10/2026`:
 *    séries 188 e 7478 respondem HTTP 404 com SGSNegocioException; a série 433
 *    responde HTTP 200 com corpo `{"erro":{}}`, que é objeto e não array. Os
 *    dois caminhos viram `BcbError` em `bcb.ts` e derrubam a série. Nos dias 1 a
 *    11 de cada mês, "última + 1" é exatamente esse intervalo vazio pro IPCA,
 *    INPC e IPCA-15, porque o IBGE só publica depois do dia 9.
 *
 * O que a sobreposição NÃO resolve: revisão de valor antigo. Ela só reconfere a
 * ponta. Revisão de 1995 depende do sync completo periódico — que custa 95 KB e
 * ~3,4 s medidos, ou seja, de graça uma vez por mês.
 */

import { DEF_SERIES, type Serie } from './series';

/** O que a RPC `resumo_indices_economicos` diz sobre uma série. */
export type ResumoSerieBanco = {
  total: number;
  primeiraCompetencia: string | null;
  ultimaCompetencia: string | null;
};

export type MotivoJanela = 'bootstrap' | 'buraco' | 'incremental';

export type Janela = {
  /** Primeira competência a pedir à fonte. */
  desdeIso: string;
  motivo: MotivoJanela;
  /** Frase pro log — o cron roda sem ninguém olhando. */
  explicacao: string;
};

/** Sobreposição padrão. Cobre o atraso de publicação com folga de 2 meses. */
export const SOBREPOSICAO_PADRAO_MESES = 3;

/** '2026-02-01' recuado 3 meses → '2025-11-01'. */
export function recuarMeses(competencia: string, meses: number): string {
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(5, 7));
  // -1 pra base zero, recua, e volta pra base 1 — assim o módulo funciona na
  // virada de ano sem caso especial.
  const total = ano * 12 + (mes - 1) - meses;
  const anoNovo = Math.floor(total / 12);
  const mesNovo = (total % 12) + 1;
  return `${anoNovo}-${String(mesNovo).padStart(2, '0')}-01`;
}

/** Quantos meses de `de` até `ate`, contando as duas pontas. */
export function mesesEntre(de: string, ate: string): number {
  const anoDe = Number(de.slice(0, 4));
  const mesDe = Number(de.slice(5, 7));
  const anoAte = Number(ate.slice(0, 4));
  const mesAte = Number(ate.slice(5, 7));
  return (anoAte - anoDe) * 12 + (mesAte - mesDe) + 1;
}

/**
 * Decide a janela de uma série a partir do que já está no banco.
 *
 * Três ramos:
 *  - **bootstrap** — série vazia. Pede tudo; não há âncora.
 *  - **buraco** — o total não fecha com o intervalo coberto, então falta mês no
 *    meio. Pede tudo, porque a janela incremental nunca alcançaria o buraco.
 *  - **incremental** — o caso de todo dia: recua a sobreposição a partir da
 *    última competência, com piso no início do catálogo.
 */
export function planejarJanela(
  serie: Serie,
  resumo: ResumoSerieBanco | undefined,
  sobreposicaoMeses = SOBREPOSICAO_PADRAO_MESES,
): Janela {
  const inicioCatalogo = DEF_SERIES[serie].inicio;

  if (sobreposicaoMeses < 1) {
    // Falhar alto é melhor que devolver uma janela que derruba a série todo mês
    // entre os dias 1 e 11 — e que falharia de um jeito difícil de atribuir.
    throw new Error(
      `Sobreposição tem que ser >= 1 mês (recebi ${sobreposicaoMeses}). ` +
        `Sem sobreposição a janela cai em intervalo vazio e o SGS responde erro, não lista vazia.`,
    );
  }

  if (!resumo || resumo.total === 0 || !resumo.ultimaCompetencia || !resumo.primeiraCompetencia) {
    return {
      desdeIso: inicioCatalogo,
      motivo: 'bootstrap',
      explicacao: `série vazia no banco, carga completa desde ${fmt(inicioCatalogo)}`,
    };
  }

  const esperado = mesesEntre(resumo.primeiraCompetencia, resumo.ultimaCompetencia);
  if (resumo.total < esperado) {
    return {
      desdeIso: inicioCatalogo,
      motivo: 'buraco',
      explicacao:
        `${resumo.total} pontos onde o intervalo ${fmt(resumo.primeiraCompetencia)}–` +
        `${fmt(resumo.ultimaCompetencia)} pede ${esperado}: falta mês no meio, ` +
        `carga completa pra cicatrizar`,
    };
  }

  const recuado = recuarMeses(resumo.ultimaCompetencia, sobreposicaoMeses);
  // Piso no início do catálogo: sondado em 19/10/2026, pedir a poupança de
  // 01/01/1990 — antes do início real da série — devolve HTTP 404.
  const desdeIso = recuado < inicioCatalogo ? inicioCatalogo : recuado;

  return {
    desdeIso,
    motivo: 'incremental',
    explicacao:
      `banco em ${fmt(resumo.ultimaCompetencia)}, pedindo desde ${fmt(desdeIso)} ` +
      `(${sobreposicaoMeses} ${sobreposicaoMeses === 1 ? 'mês' : 'meses'} de sobreposição)`,
  };
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** '2026-09-01' → 'set/2026'. Só pra mensagem de log. */
function fmt(competencia: string): string {
  return `${MESES[Number(competencia.slice(5, 7)) - 1]}/${competencia.slice(0, 4)}`;
}
