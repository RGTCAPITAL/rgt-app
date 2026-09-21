/**
 * Cliente HTTP da API pública do DJEN (endpoint `/api/v1/comunicacao` do CNJ).
 *
 * Sem autenticação, sem chave, sem termo de uso restritivo. Detalhes técnicos
 * completos e justificativa das decisões:
 * knowledge/tecnico-djen-contrato-2026-09-21.md
 *
 * NÃO importar de client components — a URL base é pública, mas o rate
 * limiter é in-memory por processo e a lógica de retry/dedup roda no server.
 */

import { mapCruParaPublicacao, normalizarCnj } from './mappers';
import { DjenRateLimiter } from './rate-limit';
import {
  DjenError,
  DjenRateLimitError,
  DjenSaturacaoTetoError,
  DjenServerError,
  DjenTimeoutError,
  DjenValidacaoError,
  type Publicacao,
} from './types';
import type { DjenResponse, Meio } from './types.raw';

const BASE_URL = process.env.DJEN_API_URL ?? 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

/** Timeout amplo — P99 real medido foi 1.1s; 20s dá margem gorda. */
const TIMEOUT_MS = 20_000;

/** Retentativas com jitter. Aplicadas em rate limit, timeout e 5xx genuínos. */
const RETRY_DELAYS_MS = [1_000, 4_000, 15_000];

/** Filtros efetivos (comprovados server-side no recon). Filtros ignorados
 *  pela API (`nomeClasse`, `codigoClasse`, `tipoComunicacao`, `orgaoId`) NÃO
 *  aparecem aqui — se o consumidor precisar, filtra client-side. */
export interface ConsultaParams {
  siglaTribunal?: string;
  /** yyyy-mm-dd — dd/mm/yyyy é rejeitado silenciosamente. */
  dataDisponibilizacaoInicio?: string;
  dataDisponibilizacaoFim?: string;
  /** CNJ com ou sem máscara — normalizamos antes de mandar. */
  numeroProcesso?: string;
  nomeParte?: string;
  numeroOab?: string;
  ufOab?: string;
  meio?: Meio;
  /** Full-text no campo `texto`. Único filtro semântico que a API respeita. */
  texto?: string;
  /** Default 100. Mín silencioso do servidor: 5. Máx testado: 1000. */
  itensPorPagina?: number;
  /** 1-based. Rejeitamos pagina < 1 no cliente. */
  pagina?: number;
}

export type FiltrosOpcionais = Omit<ConsultaParams, 'numeroOab' | 'ufOab' | 'numeroProcesso'>;

export interface RespostaPagina {
  count: number;
  items: unknown[]; // preserva raw pro caller decidir mapear ou não
  publicacoes: Publicacao[];
  rateLimitRemaining: number | null;
  tempoMs: number;
}

const rateLimiter = new DjenRateLimiter();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms: number): number {
  return ms * (0.8 + Math.random() * 0.4);
}

function validarParams(params: ConsultaParams): void {
  if (params.pagina !== undefined && params.pagina < 1) {
    throw new DjenValidacaoError(`pagina deve ser >= 1 (recebido ${params.pagina})`);
  }
  if (params.numeroProcesso !== undefined) {
    const digitos = normalizarCnj(params.numeroProcesso);
    if (digitos.length !== 20) {
      throw new DjenValidacaoError(
        `numeroProcesso precisa ter 20 dígitos após remover máscara (recebido ${digitos.length})`,
      );
    }
  }
  const formatoData = /^\d{4}-\d{2}-\d{2}$/;
  if (params.dataDisponibilizacaoInicio && !formatoData.test(params.dataDisponibilizacaoInicio)) {
    throw new DjenValidacaoError(
      `dataDisponibilizacaoInicio deve ser yyyy-mm-dd (recebido "${params.dataDisponibilizacaoInicio}")`,
    );
  }
  if (params.dataDisponibilizacaoFim && !formatoData.test(params.dataDisponibilizacaoFim)) {
    throw new DjenValidacaoError(
      `dataDisponibilizacaoFim deve ser yyyy-mm-dd (recebido "${params.dataDisponibilizacaoFim}")`,
    );
  }
  if (params.numeroOab && !params.ufOab) {
    throw new DjenValidacaoError('numeroOab exige ufOab pra não misturar homônimos');
  }
}

function montarUrl(params: ConsultaParams): string {
  const qs = new URLSearchParams();
  if (params.siglaTribunal) qs.set('siglaTribunal', params.siglaTribunal);
  if (params.dataDisponibilizacaoInicio)
    qs.set('dataDisponibilizacaoInicio', params.dataDisponibilizacaoInicio);
  if (params.dataDisponibilizacaoFim)
    qs.set('dataDisponibilizacaoFim', params.dataDisponibilizacaoFim);
  if (params.numeroProcesso) qs.set('numeroProcesso', normalizarCnj(params.numeroProcesso));
  if (params.nomeParte) qs.set('nomeParte', params.nomeParte);
  if (params.numeroOab) qs.set('numeroOab', params.numeroOab);
  if (params.ufOab) qs.set('ufOab', params.ufOab);
  if (params.meio) qs.set('meio', params.meio);
  if (params.texto) qs.set('texto', params.texto);
  qs.set('itensPorPagina', String(params.itensPorPagina ?? 100));
  qs.set('pagina', String(params.pagina ?? 1));
  return `${BASE_URL}?${qs.toString()}`;
}

async function fetchComTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new DjenTimeoutError(`Timeout após ${TIMEOUT_MS}ms: ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executa 1 request, aplica retry na taxonomia esperada. Não pagina — o
 * caller decide.
 */
async function requestUmaVez(
  params: ConsultaParams,
  remainingAnterior: number | null,
): Promise<RespostaPagina> {
  validarParams(params);
  await rateLimiter.esperar(remainingAnterior);

  const url = montarUrl(params);
  const inicio = Date.now();
  let ultimoErro: Error | null = null;

  for (let tentativa = 0; tentativa <= RETRY_DELAYS_MS.length; tentativa++) {
    try {
      const res = await fetchComTimeout(url);
      const remaining = parseIntHeader(res.headers.get('x-ratelimit-remaining'));

      if (res.status === 429) {
        ultimoErro = new DjenRateLimitError(`HTTP 429 no DJEN: ${url}`);
        if (tentativa < RETRY_DELAYS_MS.length) {
          await sleep(jitter(65_000));
          continue;
        }
        throw ultimoErro;
      }

      if (res.status >= 500) {
        const bodyText = await res.text().catch(() => '');
        const msgBaixa = bodyText.toLowerCase();
        // A API do CNJ ocasionalmente responde 500 com "muito ocupado" pra
        // input malformado (ex data em formato errado). Depois de 1 retry,
        // se persistir, tratamos como erro de validação nosso.
        const enganosa = msgBaixa.includes('muito ocupado') || msgBaixa.includes('sobrecarreg');
        if (enganosa && tentativa >= 1) {
          throw new DjenValidacaoError(
            `HTTP ${res.status} "muito ocupado" após 2 tentativas — provavelmente input ruim`,
            { url, body: bodyText.slice(0, 500) },
          );
        }
        ultimoErro = new DjenServerError(`HTTP ${res.status}`, {
          url,
          body: bodyText.slice(0, 500),
        });
        if (tentativa < RETRY_DELAYS_MS.length) {
          await sleep(jitter(RETRY_DELAYS_MS[tentativa]));
          continue;
        }
        throw ultimoErro;
      }

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new DjenError('HTTP_ERRO', `HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
      }

      const body = (await res.json()) as DjenResponse;
      const publicacoes = (body.items ?? []).map(mapCruParaPublicacao);
      return {
        count: body.count ?? 0,
        items: body.items ?? [],
        publicacoes,
        rateLimitRemaining: remaining,
        tempoMs: Date.now() - inicio,
      };
    } catch (e) {
      if (e instanceof DjenTimeoutError) {
        ultimoErro = e;
        if (tentativa < RETRY_DELAYS_MS.length) {
          await sleep(jitter(RETRY_DELAYS_MS[tentativa]));
          continue;
        }
        throw e;
      }
      if (
        e instanceof DjenValidacaoError ||
        e instanceof DjenRateLimitError ||
        e instanceof DjenServerError ||
        e instanceof DjenError
      ) {
        throw e;
      }
      // Erro desconhecido — não deveria acontecer, envolve pra dar contexto
      throw new DjenError('DESCONHECIDO', e instanceof Error ? e.message : String(e), e);
    }
  }

  throw ultimoErro ?? new DjenError('DESCONHECIDO', 'Fluxo de retry saiu sem erro nem sucesso');
}

function parseIntHeader(v: string | null): number | null {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// ---- API pública ----

/**
 * Consulta UMA página. Não itera — o consumidor decide.
 * Aceita CNJ com ou sem máscara.
 */
export async function consultarPagina(params: ConsultaParams): Promise<RespostaPagina> {
  return requestUmaVez(params, null);
}

/**
 * Busca todas as publicações de UM processo pelo CNJ, mais recentes primeiro
 * (a API já ordena assim). Vazio quando o processo não teve publicação desde
 * set/2024 (o DJEN não tem retroativo antes disso).
 */
export async function buscarPorCnj(
  cnj: string,
  opts: { limite?: number } = {},
): Promise<Publicacao[]> {
  const limite = opts.limite ?? 100;
  const pagina1 = await consultarPagina({
    numeroProcesso: cnj,
    itensPorPagina: Math.min(limite, 100),
    pagina: 1,
  });
  return pagina1.publicacoes.slice(0, limite);
}

/**
 * Busca por advogado. Sem UF misturaria homônimos — validador exige.
 */
export async function buscarPorOab(
  oab: string,
  uf: string,
  filtros: FiltrosOpcionais = {},
): Promise<Publicacao[]> {
  const resp = await consultarPagina({
    ...filtros,
    numeroOab: oab,
    ufOab: uf,
    itensPorPagina: 100,
    pagina: 1,
  });
  return resp.publicacoes;
}

/**
 * Async iterator que pagina até esgotar. Se count === 10000 na página 1,
 * lança `DjenSaturacaoTetoError` ANTES de iterar — o chamador precisa
 * refatiar (por dia único, por meio, ou por outro filtro).
 */
export async function* iterarPublicacoes(params: ConsultaParams): AsyncGenerator<Publicacao> {
  const itensPorPagina = params.itensPorPagina ?? 100;
  let pagina = 1;
  let remaining: number | null = null;

  while (true) {
    const resp = await requestUmaVez({ ...params, pagina, itensPorPagina }, remaining);
    remaining = resp.rateLimitRemaining;

    if (pagina === 1 && resp.count >= 10_000) {
      throw new DjenSaturacaoTetoError(
        `count = ${resp.count} na página 1 — refatie a query (por dia único ou por meio) antes de iterar`,
        { params, count: resp.count },
      );
    }

    if (resp.publicacoes.length === 0) return;

    for (const pub of resp.publicacoes) yield pub;

    // Fim natural — última página incompleta
    if (resp.publicacoes.length < itensPorPagina) return;

    pagina++;

    // Guarda-corpo: 100 páginas * 100 itens = 10k. Além disso, saturamos.
    if (pagina > 100) {
      throw new DjenSaturacaoTetoError(
        `paginação passou de 100 sem fim natural — provavelmente saturando`,
        { params, pagina },
      );
    }
  }
}
