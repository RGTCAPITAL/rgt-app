/**
 * Cálculo do fator de correção monetária a partir das séries persistidas.
 *
 * Convenção de competências (a mesma das contadorias judiciais): o índice do mês
 * da data-base NÃO se aplica — o valor já está expresso naquele mês. A correção
 * começa no mês seguinte. Então corrigir de jan/2026 até ago/2026 aplica as
 * variações de fev a ago (7 meses), não 8.
 *
 * Duas estratégias, nesta ordem de preferência:
 *  1. Número-índice: `fator = I_final / I_base`. Uma divisão, sem deriva.
 *  2. Encadeamento das variações mensais. Cada valor já vem arredondado em 2
 *     casas, então multiplicar 200+ deles acumula erro — é o fallback.
 *
 * Quando falta dado no meio do intervalo a função FALHA em vez de devolver um
 * fator parcial. Um fator silenciosamente menor significa não corrigir o
 * crédito, o que vira dinheiro perdido numa proposta.
 */

export type PontoPersistido = {
  competencia: string; // ISO, dia 1
  variacao_pct: number;
  numero_indice: number | null;
};

export type ResultadoFator =
  | {
      ok: true;
      fator: number;
      metodo: 'numero_indice' | 'encadeamento';
      competenciaInicial: string;
      competenciaFinal: string;
      mesesAplicados: number;
    }
  | { ok: false; erro: string };

/** '2026-03-15' → '2026-03-01' */
export function competenciaDe(dataIso: string): string {
  return `${dataIso.slice(0, 7)}-01`;
}

/** Competência seguinte: '2026-12-01' → '2027-01-01' */
export function proximaCompetencia(competencia: string): string {
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(5, 7));
  return mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
}

/** Lista as competências de `de` até `ate`, ambas inclusivas */
export function competenciasEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  let atual = de;
  // Guarda contra intervalo invertido ou loop infinito por entrada malformada
  for (let i = 0; atual <= ate && i < 2000; i++) {
    out.push(atual);
    atual = proximaCompetencia(atual);
  }
  return out;
}

/**
 * Fator de correção entre duas datas.
 *
 * @param pontos série já carregada do banco (qualquer ordem)
 * @param dataBaseIso data-base do crédito
 * @param dataFinalIso data até a qual corrigir (normalmente hoje)
 */
export function calcularFator(
  pontos: PontoPersistido[],
  dataBaseIso: string,
  dataFinalIso: string,
): ResultadoFator {
  const competenciaBase = competenciaDe(dataBaseIso);
  const competenciaFinal = competenciaDe(dataFinalIso);

  if (competenciaFinal < competenciaBase) {
    return { ok: false, erro: 'Data final anterior à data-base.' };
  }
  // Mesmo mês: nada a corrigir
  if (competenciaFinal === competenciaBase) {
    return {
      ok: true,
      fator: 1,
      metodo: 'numero_indice',
      competenciaInicial: competenciaBase,
      competenciaFinal,
      mesesAplicados: 0,
    };
  }

  const porCompetencia = new Map(pontos.map((p) => [p.competencia, p]));

  // Estratégia 1: número-índice nas duas pontas
  const base = porCompetencia.get(competenciaBase);
  const final = porCompetencia.get(competenciaFinal);
  if (base?.numero_indice && final?.numero_indice && base.numero_indice > 0) {
    return {
      ok: true,
      fator: final.numero_indice / base.numero_indice,
      metodo: 'numero_indice',
      competenciaInicial: competenciaBase,
      competenciaFinal,
      mesesAplicados: competenciasEntre(proximaCompetencia(competenciaBase), competenciaFinal)
        .length,
    };
  }

  // Estratégia 2: encadear as variações do mês seguinte ao da base até a final
  const aAplicar = competenciasEntre(proximaCompetencia(competenciaBase), competenciaFinal);
  const faltando = aAplicar.filter((c) => !porCompetencia.has(c));
  if (faltando.length > 0) {
    return {
      ok: false,
      erro:
        `Faltam ${faltando.length} competência(s) na série para corrigir de ` +
        `${competenciaBase} até ${competenciaFinal}. Primeira ausente: ${faltando[0]}. ` +
        `Sincronize os índices antes de calcular.`,
    };
  }

  let fator = 1;
  for (const c of aAplicar) {
    fator *= 1 + porCompetencia.get(c)!.variacao_pct / 100;
  }

  return {
    ok: true,
    fator,
    metodo: 'encadeamento',
    competenciaInicial: competenciaBase,
    competenciaFinal,
    mesesAplicados: aAplicar.length,
  };
}
