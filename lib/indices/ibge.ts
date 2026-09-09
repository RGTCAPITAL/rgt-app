/**
 * Cliente da API de agregados do IBGE — usado só pro NÚMERO-ÍNDICE do IPCA.
 *
 * Por que buscar o número-índice em vez de só a variação mensal: o fator de
 * correção vira `I_final / I_inicial`, uma divisão. Encadear variações mensais
 * arredondadas em 2 casas acumula deriva — já diverge na 6ª casa em 3 meses, e
 * precatório antigo tem 200+ meses de correção.
 *
 * Sem autenticação, CORS liberado.
 */

import { IBGE_IPCA } from './series';

const BASE = 'https://servicodados.ibge.gov.br/api/v3/agregados';
const TIMEOUT_MS = 20_000;

export class IbgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IbgeError';
  }
}

export type PontoIndice = {
  /** Competência: 1º dia do mês, ISO */
  competencia: string;
  /** Número-índice (base dez/1993 = 100) */
  numeroIndice: number;
};

/** '202603' → '2026-03-01' */
function competenciaDePeriodo(periodo: string): string {
  return `${periodo.slice(0, 4)}-${periodo.slice(4, 6)}-01`;
}

/** '2026-03-01' → '202603' */
function periodoDeIso(iso: string): string {
  return iso.slice(0, 4) + iso.slice(5, 7);
}

/**
 * Busca o número-índice do IPCA num intervalo de competências.
 * O IBGE devolve os valores num objeto { "202601": "7500.00", ... }.
 */
export async function buscarNumeroIndiceIpca(
  inicioIso: string,
  fimIso: string,
): Promise<PontoIndice[]> {
  const periodo = `${periodoDeIso(inicioIso)}-${periodoDeIso(fimIso)}`;
  const url =
    `${BASE}/${IBGE_IPCA.agregado}/periodos/${periodo}` +
    `/variaveis/${IBGE_IPCA.variavelNumeroIndice}?localidades=N1[all]`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new IbgeError('Timeout ao buscar número-índice do IPCA no IBGE');
    }
    throw new IbgeError(
      `Falha de rede no IBGE: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new IbgeError(`IBGE respondeu ${res.status}`);

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    throw new IbgeError(`IBGE devolveu ${contentType || 'sem content-type'} em vez de JSON`);
  }

  const corpo: unknown = await res.json();
  if (!Array.isArray(corpo) || corpo.length === 0) {
    throw new IbgeError('Resposta do IBGE vazia ou fora do formato esperado');
  }

  const serie = (
    corpo[0] as {
      resultados?: Array<{ series?: Array<{ serie?: Record<string, string> }> }>;
    }
  )?.resultados?.[0]?.series?.[0]?.serie;

  if (!serie || typeof serie !== 'object') {
    throw new IbgeError('Não encontrei o bloco de série na resposta do IBGE');
  }

  const pontos: PontoIndice[] = [];
  for (const [periodoBruto, valorBruto] of Object.entries(serie)) {
    // O IBGE usa '...' pra período sem dado publicado
    if (valorBruto === '...' || valorBruto === '-' || valorBruto == null) continue;
    const num = Number(valorBruto);
    if (!Number.isFinite(num)) continue;
    pontos.push({ competencia: competenciaDePeriodo(periodoBruto), numeroIndice: num });
  }

  return pontos.sort((a, b) => a.competencia.localeCompare(b.competencia));
}
