/**
 * Tipos crus da API do DJEN (endpoint `/api/v1/comunicacao` do CNJ).
 *
 * Mantidos separados dos tipos de aplicação (`./types.ts`) por dois motivos:
 * 1. Preservar fidelidade ao JSON literal, incluindo redundâncias (data em
 *    dois formatos, id do vínculo advogado-comunicação), pra que o payload
 *    cru guardado em `djen_publicacoes.raw` case 1:1 com o que a API mandou.
 * 2. Isolar mudanças da API. Se o CNJ mudar um campo, ajusta-se aqui e o
 *    resto do sistema (que consome `Publicacao` normalizado) não quebra.
 *
 * Enums foram observados empiricamente em 60+ requests reais (reconhecimento
 * de 2026-09-21, ver knowledge/tecnico-djen-contrato-2026-09-21.md). Onde a
 * lista pode não estar completa, usa-se `string` genérico com comentário.
 */

/** Ativo = credor. Passivo = ente devedor. Terceiro = raro (perito, etc). */
export type Polo = 'A' | 'P' | 'T';

/** D = Diário de Justiça Eletrônico. E = Plataforma Nacional de Editais. */
export type Meio = 'D' | 'E';

export type MeioCompleto =
  'Diário de Justiça Eletrônico Nacional' | 'Plataforma Nacional de Editais';

/**
 * Advogado vinculado ao destinatário. Nome NUNCA vem mascarado (mesmo em
 * processo trabalhista, onde a parte pode vir com iniciais).
 */
export interface DjenAdvogado {
  id: number;
  nome: string;
  /** Pode ter sufixo alfa (ex "23110A"). Não normalizar — perde identidade. */
  numero_oab: string;
  uf_oab: string;
}

/**
 * Vínculo comunicação ↔ advogado. Traz metadados do vínculo em si (id,
 * timestamps) e o advogado aninhado. O `advogado_id` é redundante com
 * `advogado.id` — dois campos, mesmo valor.
 */
export interface DjenDestinatarioAdvogado {
  id: number;
  comunicacao_id: number;
  advogado_id: number;
  created_at: string; // "yyyy-mm-ddTHH:MM:SS" sem timezone (BRT presumido)
  updated_at: string;
  advogado: DjenAdvogado;
}

/**
 * Parte do processo. Nome PODE vir mascarado ("E.A.D.O.") em ~40% dos
 * precatórios trabalhistas — decisão do próprio TST por sensibilidade,
 * não limitação da API. Filtrar por `mascarado === true` no consumidor
 * requer usar o tipo de aplicação `Destinatario`.
 */
export interface DjenDestinatario {
  comunicacao_id: number;
  nome: string;
  polo: Polo;
}

/**
 * Item de resposta. Todos os campos abaixo apareceram em 100% das amostras
 * exceto onde explicitamente marcado.
 */
export interface DjenItem {
  id: number;

  /** Hash alfanumérico case-sensitive, 30 chars. Chave de dedup secundária. */
  hash: string;

  /** yyyy-mm-dd. Preferir esta forma. */
  data_disponibilizacao: string;

  /** dd/mm/yyyy — REDUNDANTE. Ignorar em favor de `data_disponibilizacao`. */
  datadisponibilizacao: string;

  /** Ex "TRT19", "TJAL", "TRF5", "TJSP", "STJ", "TST". */
  siglaTribunal: string;

  /**
   * Enum observado (não estável): "Intimação" | "Citação" | "Lista de
   * distribuição". Usar string pra sobreviver a novos valores.
   */
  tipoComunicacao: string;

  nomeOrgao: string;
  idOrgao: number;

  /** Íntegra do despacho. Pode conter <br>/<br><br> como separador. */
  texto: string;

  /** 20 dígitos sem máscara. */
  numero_processo: string;

  /** Ex "0001350-96.2025.5.19.0000". */
  numeroprocessocommascara: string;

  meio: Meio;
  meiocompleto: MeioCompleto;

  /** ~96% preenchido; ~4% null. */
  link: string | null;

  /**
   * Enum observado (não estável): "Notificação" | "Distribuição" |
   * "Intimação" | "Ato ordinatório" | "Despacho" | "DESPACHO/DECISÃO" |
   * "Sentença" | "Devedores" | "Intimação do Requisitório". Capitalização
   * mista, preservada.
   */
  tipoDocumento: string;

  /**
   * Capitalização legada esquisita (ex "AçãO TRABALHISTA - RITO
   * ORDINáRIO"). Normalizar sempre antes de exibir pro usuário.
   */
  nomeClasse: string;

  /** É STRING, não number. Ex "1265", "12078". */
  codigoClasse: string;

  /** NÃO é único — múltiplos items com valor 1 no mesmo tribunal. */
  numeroComunicacao: number;

  ativo: boolean;
  status: string;

  motivo_cancelamento: string | null;
  data_cancelamento: string | null;

  destinatarios: DjenDestinatario[];

  /**
   * Nome do campo é minúsculo, uma palavra (não `destinatarios_advogados`).
   * PODE ser vazio (~2% dos items).
   */
  destinatarioadvogados: DjenDestinatarioAdvogado[];
}

export interface DjenResponse {
  status: 'success' | 'error';
  message: string;

  /**
   * CAPADO EM 10000. Se `count === 10000`, o total real pode ser MAIOR e o
   * chamador precisa refatiar a query (por dia único ou por meio). Ler
   * apenas na página 1 — nas subsequentes o valor pode virar `items.length`.
   */
  count: number;

  items: DjenItem[];
}
