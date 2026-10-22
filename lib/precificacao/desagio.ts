/**
 * O percentual de aquisição por ano de LOA.
 *
 * O sistema NÃO calcula deságio. Quem define é o Renato, por ano de LOA, e ele
 * muda quando quer — foi o que ele pediu em 2026-10-20:
 *
 *   "Precatório LOA 26, esse mês vou pagar 55%, próximo mês eu posso pagar
 *    65%. Então quem vai dizer sou eu, no meu dia a dia."
 *
 * A razão de mudar também é dele: "cada vez mais que se aproxima do pagamento
 * do governo, maior será a minha proposta". Menos tempo de espera, menos
 * desconto.
 *
 * Este módulo é puro: recebe os fatores já carregados e uma data, devolve qual
 * vale. Sem banco, sem rede, sem relógio — `hojeIso` entra por parâmetro, pelo
 * mesmo motivo do módulo de frescor: num componente cliente `new Date()` roda
 * no fuso do navegador e discorda do servidor na virada do dia.
 */

/** Sobre o que o percentual incide. Decisão do Renato, gravada por fator. */
export type BaseDesagio = 'face' | 'liquido';

export type FatorLoa = {
  id: string;
  loaAno: number;
  percentual: number;
  base: BaseDesagio;
  /** Início da vigência, ISO (YYYY-MM-DD). */
  vigenteDesde: string;
  observacao: string | null;
};

/** Como a linha de `fatores_loa` chega do PostgREST. */
export type LinhaFatorLoa = {
  id: string;
  loa_ano: number;
  /** `numeric` chega como string no PostgREST. */
  percentual: string | number;
  base: BaseDesagio;
  vigente_desde: string;
  observacao: string | null;
};

/** Colunas pra pedir no select, na mesma ordem do tipo acima. */
export const COLUNAS_FATOR_LOA = 'id, loa_ano, percentual, base, vigente_desde, observacao';

/**
 * Linha do banco → FatorLoa. Converter o percentual aqui evita que a
 * comparação vire ordenação alfabética ("100" < "55") em quem consumir.
 */
export function fatorDaLinha(l: LinhaFatorLoa): FatorLoa {
  return {
    id: l.id,
    loaAno: l.loa_ano,
    percentual: Number(l.percentual),
    base: l.base,
    vigenteDesde: l.vigente_desde,
    observacao: l.observacao,
  };
}

/**
 * O fator aplicável a uma LOA numa data.
 *
 * É o mais recente cuja vigência já começou. Vigência futura não conta — ele
 * pode deixar o percentual de novembro cadastrado em outubro sem que isso mude
 * o preço de hoje.
 */
export function fatorVigente(
  fatores: readonly FatorLoa[],
  loaAno: number,
  dataIso: string,
): FatorLoa | null {
  const candidatos = fatores
    .filter((f) => f.loaAno === loaAno && f.vigenteDesde <= dataIso)
    .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
  return candidatos[0] ?? null;
}

/**
 * O preço que o percentual produz.
 *
 * `base` decide sobre qual valor incide, e a diferença não é detalhe: num
 * precatório de R$ 1 milhão com R$ 400 mil de deduções, 55% da face são
 * R$ 550 mil e 55% do líquido são R$ 330 mil. Por isso a base vem gravada no
 * fator, escolhida por quem cadastrou, e nunca é assumida aqui.
 *
 * Devolve null quando o valor que a base exige não está disponível — um preço
 * calculado sobre valor faltando seria um número inventado com cara de conta.
 */
export function precoPeloFator(
  fator: FatorLoa,
  valores: { face: number | null; liquido: number | null },
): number | null {
  const valor = fator.base === 'face' ? valores.face : valores.liquido;
  if (valor === null || !Number.isFinite(valor) || valor <= 0) return null;
  return (valor * fator.percentual) / 100;
}

export type PrecoSugerido =
  | {
      ok: true;
      /** Em reais, arredondado no centavo — é o número que vai pro campo. */
      preco: number;
      fator: FatorLoa;
      /** O valor sobre o qual o percentual incidiu, já antes do % de aquisição. */
      valorBase: number;
      percentualAquisicao: number;
      /** O líquido ainda é faixa: a sugestão é estimativa, não proposta. */
      provisorio: boolean;
    }
  /** O valor que a base exige não foi calculado (falta dado na cascata). */
  | { ok: false; motivo: 'base_indisponivel'; fator: FatorLoa };

/**
 * O preço que a tela de precificação sugere (RGT-97).
 *
 * `face` é o bruto atualizado até a data do cálculo, não o nominal da
 * data-base: é o valor cheio do crédito no dia da proposta, que é o que o
 * cedente compara. O percentual de aquisição (100 = crédito inteiro) entra por
 * último, porque compra parcial reduz o objeto, não o percentual da LOA.
 */
export function sugerirPreco(args: {
  fator: FatorLoa;
  brutoAtualizado: number | null;
  liquido: number | null;
  /** `operacoes.percentual_aquisicao`, 0–100. */
  percentualAquisicao: number;
  provisorio: boolean;
}): PrecoSugerido {
  const { fator, brutoAtualizado, liquido, percentualAquisicao, provisorio } = args;
  const sobreBase = precoPeloFator(fator, { face: brutoAtualizado, liquido });
  if (sobreBase === null) return { ok: false, motivo: 'base_indisponivel', fator };

  const valorBase = fator.base === 'face' ? brutoAtualizado! : liquido!;
  const preco = Math.round(sobreBase * percentualAquisicao) / 100;
  return { ok: true, preco, fator, valorBase, percentualAquisicao, provisorio };
}

export type SituacaoProposta =
  /** A operação não tem LOA preenchida — não dá pra saber qual percentual usar. */
  | { situacao: 'sem_loa' }
  /** Ninguém cadastrou percentual pra essa LOA ainda. */
  | { situacao: 'sem_fator'; loaAno: number }
  /** Há percentual vigente e nenhuma proposta feita ainda. */
  | { situacao: 'sem_proposta'; atual: FatorLoa }
  /** A proposta usou o percentual que continua valendo. */
  | { situacao: 'em_dia'; atual: FatorLoa }
  /** O percentual mudou depois da proposta. */
  | {
      situacao: 'desatualizada';
      usado: FatorLoa;
      atual: FatorLoa;
      /** Diferença em pontos percentuais. Positivo = hoje ele pagaria mais. */
      variacaoPontos: number;
    }
  /** A proposta é anterior à tabela de fatores, ou foi feita à mão. */
  | { situacao: 'origem_desconhecida'; atual: FatorLoa };

/**
 * Compara o percentual que a proposta usou com o que vale hoje.
 *
 * Existe por causa de uma frase que passou despercebida na primeira leitura do
 * áudio: *"eu tenho que atualizar as propostas todos os meses"*. Não é só a
 * tabela que muda — toda proposta em aberto daquela LOA fica desatualizada
 * junto. Sem este aviso, ele teria que lembrar de reabrir operação por
 * operação, que é o trabalho manual que a plataforma deveria tirar dele.
 *
 * `fatorUsadoId` vem de `operacoes.fator_loa_id` e é a fonte confiável: está
 * pregado no momento em que o preço foi salvo. Derivar pela data da proposta
 * seria frágil, porque corrigir um typo do mesmo dia mudaria a resposta.
 */
export function avaliarProposta(args: {
  fatores: readonly FatorLoa[];
  loaAno: number | null;
  /** `operacoes.fator_loa_id` — null em proposta manual ou anterior à tabela. */
  fatorUsadoId: string | null;
  /** Se já existe preço proposto. */
  temProposta: boolean;
  hojeIso: string;
}): SituacaoProposta {
  const { fatores, loaAno, fatorUsadoId, temProposta, hojeIso } = args;

  if (loaAno === null) return { situacao: 'sem_loa' };

  const atual = fatorVigente(fatores, loaAno, hojeIso);
  if (!atual) return { situacao: 'sem_fator', loaAno };

  if (!temProposta) return { situacao: 'sem_proposta', atual };

  const usado = fatorUsadoId ? (fatores.find((f) => f.id === fatorUsadoId) ?? null) : null;
  if (!usado) return { situacao: 'origem_desconhecida', atual };

  if (usado.id === atual.id) return { situacao: 'em_dia', atual };

  return {
    situacao: 'desatualizada',
    usado,
    atual,
    // Arredonda em 3 casas: o banco guarda numeric(6,3) e a subtração de
    // decimais em float produz 9,999999999999998 pontos sem isso.
    variacaoPontos: Math.round((atual.percentual - usado.percentual) * 1000) / 1000,
  };
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/**
 * '2026-10-01' → 'out/2026'; '2026-10-22' → '22/10/2026'.
 *
 * O mês sozinho só basta quando a vigência começa no dia 1º. Uma mudança no
 * meio do mês aparecia como "out/2026" ao lado da de 1º de outubro, e o aviso
 * de proposta desatualizada dizia "feita com 55% (out/2026), hoje 65% desde
 * out/2026" — duas datas iguais pra percentuais diferentes (RGT-97).
 */
export function fmtVigencia(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  if (dia !== '01') return `${dia}/${mes}/${ano}`;
  return `${MESES[Number(mes) - 1]}/${ano}`;
}

/** 55 → '55%'; 62.5 → '62,5%'. Sem casa decimal quando é inteiro. */
export function fmtPercentual(p: number): string {
  return `${p.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}%`;
}

export const ROTULO_BASE: Record<BaseDesagio, string> = {
  face: 'valor de face',
  liquido: 'líquido cedível',
};
