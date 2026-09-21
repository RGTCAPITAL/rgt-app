/**
 * Tipos de aplicação do DJEN — o que o resto do sistema consome.
 *
 * O contrato aqui é ESTÁVEL. Mudanças na API do CNJ ficam contidas em
 * `types.raw.ts` + `mappers.ts`, e daqui pra cima nada muda.
 */

import type { DjenItem, Meio, Polo } from './types.raw';

export type { Meio, Polo };

export interface Advogado {
  id: number;
  nome: string;
  /** Renomeado de `numero_oab` da API. Pode ter sufixo alfa ("23110A"). */
  oab: string;
  /** Renomeado de `uf_oab`. */
  uf: string;
}

export interface Destinatario {
  nome: string;
  polo: Polo;
  /**
   * Computado no mapping: true quando o nome só tem iniciais separadas por
   * ponto (ex "E.A.D.O."). Sinal de segredo do próprio tribunal — comum em
   * ~40% dos precatórios trabalhistas. Quando true, o canal comercial vira
   * o advogado (que aparece com nome completo em 98% dos casos).
   */
  mascarado: boolean;
}

/**
 * Extração automática de fatos importantes do texto da publicação. Populada
 * no ingest via `red-flags.ts` e `extrair-cessao.ts`. Serve pra alimentar
 * campos denormalizados de `djen_publicacoes` e pra red flags no UI.
 */
export interface ExtracaoTexto {
  /** Nome do fundo/securitizadora citado no texto. Ex "Prosperous FIDC". */
  cessionario?: string;
  /** Nome do credor original que cedeu, quando o texto diz "figura como cedente X". */
  credorCedente?: string;
  /** Percentual de deságio citado em contexto de cessão. */
  desagioPercentual?: number;
  /** Ano do exercício orçamentário quando aparece explicitamente. */
  anoOrcamentario?: number;
}

export type CategoriaRedFlag = 'BLOQUEADOR' | 'PRICING' | 'NAVEGACIONAL';

export interface RedFlag {
  codigo: string;
  categoria: CategoriaRedFlag;
  cor: 'vermelho' | 'amarelo' | 'cinza';
  precisao: number;
  trecho: string;
  contexto: string;
}

export interface Publicacao {
  id: number;
  hash: string;
  dataDisponibilizacao: string; // yyyy-mm-dd
  siglaTribunal: string;
  orgao: { id: number; nome: string };
  processo: { cnj: string; cnjMascarado: string };
  tipoComunicacao: string;
  tipoDocumento: string;
  classe: { codigo: string; nome: string };
  meio: Meio;
  link: string | null;
  texto: string;
  ativo: boolean;
  status: string;
  cancelamento: { data: string; motivo: string } | null;
  destinatarios: Destinatario[];
  advogados: Advogado[];
  redFlags: RedFlag[];
  extracao: ExtracaoTexto;

  /** Snapshot cru pra reprocessamento e auditoria. */
  _raw: DjenItem;
}

// ---- Erros ----

export class DjenError extends Error {
  constructor(
    public codigo: string,
    message: string,
    public detalhes?: unknown,
  ) {
    super(message);
    this.name = 'DjenError';
  }
}

/** HTTP 429 do servidor OU pré-emptivo quando o header remaining tá esgotando. */
export class DjenRateLimitError extends DjenError {
  constructor(message: string, detalhes?: unknown) {
    super('RATE_LIMIT', message, detalhes);
    this.name = 'DjenRateLimitError';
  }
}

/** Timeout do fetch (AbortController disparou). */
export class DjenTimeoutError extends DjenError {
  constructor(message: string) {
    super('TIMEOUT', message);
    this.name = 'DjenTimeoutError';
  }
}

/** 5xx genuíno (não os que a API devolve pra input malformado). */
export class DjenServerError extends DjenError {
  constructor(message: string, detalhes?: unknown) {
    super('SERVER_ERROR', message, detalhes);
    this.name = 'DjenServerError';
  }
}

/**
 * Input malformado (nosso ou deles). A API do CNJ tem o hábito de responder
 * 500 com mensagem "muito ocupado" quando a request tem parâmetro estranho
 * (ex data no formato errado). Depois de 1 retry, se persiste, é isso.
 */
export class DjenValidacaoError extends DjenError {
  constructor(message: string, detalhes?: unknown) {
    super('VALIDACAO', message, detalhes);
    this.name = 'DjenValidacaoError';
  }
}

/**
 * `count === 10000` na página 1 — o total real pode ser MAIOR e o chamador
 * precisa refatiar (por dia único ou por meio). Não é erro operacional, é
 * indicação de que a estratégia de query precisa mudar.
 */
export class DjenSaturacaoTetoError extends DjenError {
  constructor(message: string, detalhes?: unknown) {
    super('SATURACAO_TETO', message, detalhes);
    this.name = 'DjenSaturacaoTetoError';
  }
}
