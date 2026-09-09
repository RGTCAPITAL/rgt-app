/**
 * Catálogo das séries de índices que a plataforma consome.
 *
 * Os códigos SGS foram validados por cross-check independente contra o IBGE
 * (IPCA, INPC, IPCA-15) ou por prova matemática (poupança = (1+0,5%)×(1+TR)−1,
 * delta < 5e-05 em 8 meses). Trocar um código aqui muda o valor de todo
 * precatório da carteira — não mexa sem revalidar contra a fonte primária.
 */

export const SERIES = ['ipca', 'ipca_15', 'inpc', 'selic', 'poupanca', 'tr'] as const;
export type Serie = (typeof SERIES)[number];

type DefSerie = {
  /** Código da série no SGS do Banco Central */
  sgs: number;
  /** Identificador de origem gravado em indices_economicos.fonte */
  fonte: string;
  label: string;
  /** Onde esse índice é usado no cálculo — contexto pra quem for mexer */
  usoNoCalculo: string;
  /** Primeira competência disponível na série */
  inicio: string;
};

export const DEF_SERIES: Record<Serie, DefSerie> = {
  ipca: {
    sgs: 433,
    fonte: 'bcb_sgs_433',
    label: 'IPCA',
    usoNoCalculo: 'Correção do precatório expedido, a partir de ago/2025 (EC 136/2025)',
    inicio: '1980-01-01',
  },
  ipca_15: {
    sgs: 7478,
    fonte: 'bcb_sgs_7478',
    label: 'IPCA-15',
    usoNoCalculo: 'Correção na fase pré-requisitório a partir de set/2025 (Manual CJF 2026)',
    inicio: '2000-05-01',
  },
  inpc: {
    sgs: 188,
    fonte: 'bcb_sgs_188',
    label: 'INPC',
    usoNoCalculo: 'Correção de benefícios previdenciários (Lei 11.430/2006)',
    inicio: '1979-04-01',
  },
  selic: {
    sgs: 4390,
    fonte: 'bcb_sgs_4390',
    label: 'Selic acumulada no mês',
    usoNoCalculo:
      'Regime dez/2021–ago/2025 e trava da EC 136 (se IPCA+2% passar da Selic, aplica-se a Selic)',
    inicio: '1986-07-01',
  },
  poupanca: {
    sgs: 196,
    fonte: 'bcb_sgs_196',
    label: 'Poupança (pós 04/05/2012)',
    usoNoCalculo: 'Juros de mora de maio/2012 a nov/2021 (Lei 12.703/2012)',
    inicio: '2012-06-01',
  },
  tr: {
    sgs: 7811,
    fonte: 'bcb_sgs_7811',
    label: 'TR',
    usoNoCalculo: 'Correção de precatório expedido entre 10/12/2009 e 25/03/2015 (Res. CNJ 303)',
    inicio: '1991-03-01',
  },
};

/**
 * IPCA também vem do IBGE, que publica o NÚMERO-ÍNDICE (base dez/1993 = 100).
 * Preferimos ele pro fator de correção: `fator = I_final / I_inicial` é uma
 * divisão só, enquanto encadear variações mensais arredondadas em 2 casas
 * acumula deriva ao longo de centenas de meses.
 */
export const IBGE_IPCA = {
  agregado: 1737,
  variavelNumeroIndice: 2266,
  variavelVariacaoMensal: 63,
  fonte: 'ibge_1737_2266',
} as const;
