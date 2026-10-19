/**
 * Tipos da precificação de precatório.
 *
 * O formato saiu de um ofício requisitório real do TJAL (precatório
 * 0502141-84.2025.8.02.9003, expedido em 12/06/2025), não de suposição. Cada
 * campo aqui corresponde a uma linha que o tribunal de fato imprime.
 *
 * Duas lições desse documento que contradizem o que o sistema assumia:
 *
 * 1. O PSS vem como VALOR em reais, não como percentual. O ofício diz
 *    "Valor da Previdência Social: 57.596,17". A operação guardava `pss_pct`,
 *    o que obrigava a pessoa a calcular de cabeça o que o documento já dá
 *    pronto — e a errar quando a alíquota do ente não é a padrão.
 *
 * 2. Honorários sucumbenciais não são dedução do credor: são um beneficiário
 *    separado dentro do mesmo precatório, que recebe direto do ente devedor.
 *    O "valor global" soma os dois. Quem compra o crédito compra só a parte
 *    do credor. Tratar isso como desconto erraria o valor para menos.
 */

import type { Serie } from '@/lib/indices/series';
import type { ModoAliquota } from './ir';

/** Como o crédito está composto na data-base, conforme o ofício. */
export type ComposicaoOficio = {
  /** Principal do beneficiário (não o do precatório inteiro). */
  principal: number;
  /** Juros moratórios. */
  juros: number;
  /** Correção já aplicada pelo tribunal até a data-base. */
  correcao: number;
  /** Data do último cálculo homologado. A correção roda a partir daqui. */
  dataBase: string;
  /** Índice que o ofício manda aplicar daqui pra frente. */
  indice: Serie;
};

/**
 * O que sai do valor do credor antes de chegar no disponível.
 *
 * `null` significa "não sei", e é diferente de `0`, que significa "sei que é
 * zero". A distinção é o que permite a tela dizer "falta informação" em vez
 * de entregar um total falsamente preciso.
 */
export type Deducoes = {
  /** Valor em reais, como o ofício entrega. */
  pssValor: number | null;
  /** O ofício diz se incide. Quando não incide, o valor é 0 e não null. */
  pssIncide: boolean;

  /** Honorários contratuais, que saem do bolso do credor. */
  honorariosContratuaisValor: number | null;
  /** Alternativa: percentual sobre o bruto do credor. */
  honorariosContratuaisPct: number | null;

  /** Cessão anterior averbada — parte do crédito já tem outro dono. */
  cessaoAnterior: number | null;
  /** Penhora, arresto ou bloqueio sobre o crédito. */
  penhora: number | null;
  /** Compensação tributária determinada pelo juízo. */
  compensacaoTributaria: number | null;
};

/** Tributação. Modelada à parte porque a base de incidência é controversa. */
export type Tributacao = {
  /** O ofício indica se há retenção de IR. */
  irIncide: boolean;
  /**
   * Meses a que o crédito se refere. Maior que zero aplica RRA (art. 12-A);
   * zero ou null aplica a retenção fixa de 3%. A regra é a mesma que a
   * Lajedo exibe na própria interface.
   */
  rraMeses: number | null;
  /** Padrão conservador: provisiona pela alíquota máxima. */
  modoAliquota?: ModoAliquota;
};

export type EntradaCascata = {
  composicao: ComposicaoOficio;
  deducoes: Deducoes;
  tributacao: Tributacao;
  /** Até quando corrigir. Normalmente hoje. */
  dataFinal: string;
  /** Fator de correção da data-base até dataFinal, vindo do motor de índices. */
  fatorCorrecao: number | null;
};

/** De onde veio cada número — o que permite auditar a conta. */
export type OrigemValor =
  /** Lido do ofício requisitório. */
  | 'oficio'
  /** Calculado pelo sistema a partir de outras linhas. */
  | 'calculado'
  /** Digitado por uma pessoa. */
  | 'digitado'
  /** Informação ausente. A linha aparece, o valor não. */
  | 'falta';

export type LinhaCascata = {
  id: string;
  rotulo: string;
  /** null quando a origem é 'falta'. */
  valor: number | null;
  sinal: '+' | '−' | '=';
  origem: OrigemValor;
  /** Explicação curta: "11% sobre o principal", "Selic de 02/2024 a 10/2026". */
  detalhe?: string;
  /** Dispositivo que obriga essa linha a existir. */
  norma?: string;
  /**
   * Peso da linha sobre o total do crédito atualizado. É o que permite ver
   * que honorário comeu 20% e imposto 6% sem fazer conta — a Lajedo mostra
   * isso em toda linha e é metade da legibilidade da tela.
   */
  percentualDoTotal?: number;
  /** Subtotais recebem peso visual na tela. */
  destaque?: boolean;
};

/**
 * Impedimento de fechar preço.
 *
 * `impedeTotal` separa o que torna a conta impossível (falta o principal) do
 * que apenas a deixa incerta (falta saber se há penhora). O primeiro zera o
 * total; o segundo o mantém, marcado como provisório.
 */
export type Bloqueio = {
  campo: string;
  mensagem: string;
  impedeTotal: boolean;
};

export type ResultadoCascata = {
  linhas: LinhaCascata[];
  /** Bruto do credor já corrigido até dataFinal. */
  brutoAtualizado: number | null;
  /** O que sobra depois das deduções. É sobre isto que incide o deságio. */
  liquidoDisponivel: number | null;
  /** Quando há bloqueio não-total, o líquido é uma faixa, não um ponto. */
  provisorio: boolean;
  bloqueios: Bloqueio[];
};
