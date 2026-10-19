/**
 * Imposto de renda sobre crédito judicial.
 *
 * Dois regimes, e a regra de qual usar está na própria interface da Lajedo:
 * "Se incidir IR e meses = 0, aplica IR fixo de 3%. Se meses > 0, aplica RRA."
 *
 * RRA (Rendimentos Recebidos Acumuladamente, art. 12-A da Lei 7.713/88) existe
 * porque receber de uma vez o que deveria ter sido pago mês a mês jogaria o
 * contribuinte na alíquota máxima injustamente. O cálculo divide a base pelo
 * número de meses a que o crédito se refere, aplica a tabela sobre esse
 * quociente, e multiplica o imposto de volta.
 *
 * ---
 *
 * SOBRE A BASE DE INCIDÊNCIA — leia antes de mexer.
 *
 * O que entra na base é a decisão mais cara deste arquivo, e ela foi deduzida
 * de um caso real da Lajedo, não de suposição. Partindo do precatório
 * ADILSON (TRF5, 96 meses de RRA, IR de R$ 30.469,76), foram testadas sete
 * bases possíveis:
 *
 *   total do crédito            R$ 506.140,11  → IR 53.172,53  (erro +74%)
 *   total − honorários          R$ 404.912,09  → IR 27.479,30  (erro −10%)
 *   principal + juros           R$ 440.596,45  → IR 35.508,28  (erro +17%)
 *   principal + Selic           R$ 489.172,83  → IR 48.506,53  (erro +59%)
 *   principal − honorários      R$ 322.401,14  → IR 11.741,93  (erro −61%)
 *   PRINCIPAL ATUALIZADO        R$ 423.629,16  → IR 30.482,02  (erro +0,04%)
 *
 * Só o principal reproduz o número deles. Faz sentido jurídico: juros de mora
 * em verba alimentar não são renda tributável (STF, Tema 808), e correção
 * monetária repõe poder de compra, não acresce patrimônio.
 *
 * ---
 *
 * SOBRE A ALÍQUOTA — e aqui há uma armadilha.
 *
 * A base mensal daquele caso (423.629,16 ÷ 96 = R$ 4.412,80) cai na faixa de
 * 22,5% pela tabela oficial. A Lajedo aplicou a última faixa, de 27,5%.
 *
 * O instinto diz que isso provisiona imposto a mais. É o contrário: a dedução
 * da última faixa (R$ 896,00) é tão maior que a da faixa de 22,5% (R$ 662,77)
 * que o resultado fica MENOR. Naquele caso, R$ 30.482 contra R$ 31.690 —
 * aplicar sempre a última faixa subestima o imposto em R$ 1.208.
 *
 * Por isso o padrão aqui é o progressivo, que é o que a lei manda. O modo
 * `ultima_faixa` existe para reproduzir e conferir o número da Lajedo, não
 * para usar em proposta. Acima de R$ 4.664,68 de base mensal os dois
 * coincidem, porque aí a última faixa é a correta mesmo.
 */

/** Faixa da tabela progressiva mensal. */
type Faixa = {
  /** Limite superior da faixa, em reais. */
  ate: number;
  aliquota: number;
  deduzir: number;
};

/**
 * Tabela progressiva mensal do IRPF.
 *
 * Versionada por vigência porque precatório antigo pode exigir a tabela da
 * época, e porque a tabela muda por medida provisória sem aviso. Quando
 * mudar, adicione uma entrada nova — não edite a existente, ou todo cálculo
 * já feito passa a dar outro número.
 *
 * TODO conferir se houve alteração em 2026 antes do go-live.
 */
const TABELAS: { vigenteDe: string; faixas: Faixa[] }[] = [
  {
    vigenteDe: '2024-02-01',
    faixas: [
      { ate: 2259.2, aliquota: 0, deduzir: 0 },
      { ate: 2826.65, aliquota: 7.5, deduzir: 169.44 },
      { ate: 3751.05, aliquota: 15, deduzir: 381.44 },
      { ate: 4664.68, aliquota: 22.5, deduzir: 662.77 },
      { ate: Infinity, aliquota: 27.5, deduzir: 896.0 },
    ],
  },
];

export type ModoAliquota =
  /** Tabela progressiva, como a Receita calcula. */
  | 'progressivo'
  /**
   * Sempre a última faixa da tabela, como a Lajedo faz. Reproduz o número
   * deles, mas subestima o imposto quando a base mensal fica abaixo de
   * R$ 4.664,68. Use para conferência, não para precificar.
   */
  | 'ultima_faixa';

export type EntradaIr = {
  /** Base tributável. Por padrão, o principal atualizado. */
  base: number;
  /** Meses a que o crédito se refere. 0 ou null aplica o IR fixo. */
  rraMeses: number | null;
  modo?: ModoAliquota;
  /** Data pra escolher a tabela vigente. Padrão: hoje. */
  dataIso?: string;
};

export type ResultadoIr = {
  valor: number;
  regime: 'rra' | 'fixo_3' | 'isento';
  /** Alíquota efetiva sobre a base — o número que o usuário confere. */
  aliquotaEfetiva: number;
  detalhe: string;
};

function tabelaVigente(dataIso: string): Faixa[] {
  const aplicaveis = TABELAS.filter((t) => t.vigenteDe <= dataIso);
  const escolhida = aplicaveis[aplicaveis.length - 1] ?? TABELAS[0]!;
  return escolhida.faixas;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Imposto sobre uma base mensal, pela tabela. */
function impostoMensal(baseMensal: number, faixas: Faixa[], modo: ModoAliquota): number {
  if (modo === 'ultima_faixa') {
    const maxima = faixas[faixas.length - 1]!;
    return Math.max(0, (baseMensal * maxima.aliquota) / 100 - maxima.deduzir);
  }
  for (const f of faixas) {
    if (baseMensal <= f.ate) {
      return Math.max(0, (baseMensal * f.aliquota) / 100 - f.deduzir);
    }
  }
  return 0;
}

/**
 * IR sobre o crédito.
 *
 * `rraMeses > 0` aplica o regime do art. 12-A; `0` ou `null` aplica a
 * retenção fixa de 3% que o mercado usa como provisão quando o crédito não se
 * enquadra em RRA.
 */
export function calcularIr(entrada: EntradaIr): ResultadoIr {
  const { base, rraMeses } = entrada;
  const modo = entrada.modo ?? 'progressivo';
  const dataIso = entrada.dataIso ?? new Date().toISOString().slice(0, 10);

  if (base <= 0) {
    return { valor: 0, regime: 'isento', aliquotaEfetiva: 0, detalhe: 'base zerada' };
  }

  if (!rraMeses || rraMeses <= 0) {
    const valor = round2(base * 0.03);
    return {
      valor,
      regime: 'fixo_3',
      aliquotaEfetiva: 3,
      detalhe: 'retenção fixa de 3% — crédito sem RRA',
    };
  }

  const faixas = tabelaVigente(dataIso);
  const baseMensal = base / rraMeses;
  const mensal = impostoMensal(baseMensal, faixas, modo);
  const valor = round2(mensal * rraMeses);
  const aliquotaEfetiva = round2((valor / base) * 100);

  const sufixo =
    modo === 'ultima_faixa'
      ? ', última faixa da tabela (modo de conferência)'
      : ', tabela progressiva';

  return {
    valor,
    regime: 'rra',
    aliquotaEfetiva,
    detalhe: `RRA de ${rraMeses} meses sobre R$ ${baseMensal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mês${sufixo}`,
  };
}
