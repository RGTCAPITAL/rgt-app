/**
 * Cliente da API SGS do Banco Central.
 *
 * Sem autenticação. O que a API tem de traiçoeiro (tudo observado ao vivo em
 * 09/09/2026, não é precaução teórica):
 *
 *  1. Responde HTTP 200 com uma página HTML de WAF quando a consulta é grande
 *     demais. `JSON.parse` cego quebra ou, pior, engole lixo.
 *  2. `/ultimos/N` devolveu resposta cacheada de um N anterior por vários
 *     minutos. Por isso só usamos dataInicial/dataFinal.
 *  3. Séries diárias estouram em 10 anos por consulta (HTTP 406). As mensais
 *     que usamos aqui não têm esse limite, mas a validação fica de guarda.
 *
 * A armadilha do mês corrente parcial (a série 4390 devolve o mês em curso
 * ainda acumulando) é tratada em sync.ts, que é quem sabe o que é "mês fechado".
 */

import { DEF_SERIES, type Serie } from './series';

const BASE = 'https://api.bcb.gov.br/dados/serie';
const TIMEOUT_MS = 20_000;

export class BcbError extends Error {
  constructor(
    message: string,
    public serie?: Serie,
  ) {
    super(message);
    this.name = 'BcbError';
  }
}

export type PontoSerie = {
  /** Competência normalizada: 1º dia do mês, ISO (YYYY-MM-DD) */
  competencia: string;
  /** Variação percentual no mês */
  valor: number;
};

/** dd/MM/aaaa — formato que o SGS exige */
function paraFormatoBcb(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

/** dd/MM/aaaa → primeiro dia do mês em ISO */
function competenciaDeBcb(data: string): string {
  const [, mes, ano] = data.split('/');
  return `${ano}-${mes}-01`;
}

/**
 * Busca uma série mensal do SGS num intervalo.
 *
 * Retorna os pontos já normalizados (competência no dia 1, valor numérico).
 * Lança BcbError em qualquer resposta que não seja um array JSON válido —
 * incluindo o caso do HTML com HTTP 200.
 */
export async function buscarSerie(
  serie: Serie,
  inicioIso: string,
  fimIso: string,
): Promise<PontoSerie[]> {
  const { sgs } = DEF_SERIES[serie];
  const url =
    `${BASE}/bcdata.sgs.${sgs}/dados?formato=json` +
    `&dataInicial=${encodeURIComponent(paraFormatoBcb(inicioIso))}` +
    `&dataFinal=${encodeURIComponent(paraFormatoBcb(fimIso))}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new BcbError(`Timeout ao buscar ${serie} no BCB`, serie);
    }
    throw new BcbError(
      `Falha de rede ao buscar ${serie}: ${err instanceof Error ? err.message : String(err)}`,
      serie,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new BcbError(`BCB respondeu ${res.status} para ${serie}`, serie);
  }

  // Armadilha 1: WAF devolve HTML com status 200
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    throw new BcbError(
      `BCB devolveu ${contentType || 'sem content-type'} em vez de JSON para ${serie} ` +
        `(provável bloqueio de WAF — consulta ampla demais)`,
      serie,
    );
  }

  const corpo: unknown = await res.json();
  if (!Array.isArray(corpo)) {
    throw new BcbError(`Resposta do BCB para ${serie} não é um array`, serie);
  }

  return corpo.map((item, i) => {
    if (typeof item !== 'object' || item === null) {
      throw new BcbError(`Item ${i} da série ${serie} não é objeto`, serie);
    }
    const { data, valor } = item as { data?: unknown; valor?: unknown };
    if (typeof data !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(data)) {
      throw new BcbError(`Item ${i} da série ${serie} com data inválida: ${String(data)}`, serie);
    }
    const num = Number(valor);
    if (!Number.isFinite(num)) {
      throw new BcbError(`Item ${i} da série ${serie} com valor inválido: ${String(valor)}`, serie);
    }
    return { competencia: competenciaDeBcb(data), valor: num };
  });
}
