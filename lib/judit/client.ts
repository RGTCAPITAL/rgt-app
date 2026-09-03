/**
 * Cliente HTTP pra Judit API.
 *
 * Autenticação: header `api-key: <JUDIT_API_KEY>` (padrão da Judit).
 * Endpoints ajustados conforme doc oficial quando plano API for contratado.
 *
 * NÃO importar de client components — usar apenas em server actions.
 */

import type { PayloadJudit } from './types';

const BASE_URL = process.env.JUDIT_API_URL ?? 'https://api.judit.io/v2';
const TIMEOUT_MS = 45_000; // Judit pode demorar até ~30s por consulta live

export class JuditError extends Error {
  constructor(
    message: string,
    public status?: number,
    public payload?: unknown,
  ) {
    super(message);
    this.name = 'JuditError';
  }
}

function getApiKey(): string {
  const key = process.env.JUDIT_API_KEY;
  if (!key) {
    throw new JuditError('JUDIT_API_KEY não configurada no ambiente');
  }
  return key;
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'api-key': getApiKey(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    const bodyText = await res.text();
    let body: unknown;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      body = bodyText;
    }

    if (!res.ok) {
      throw new JuditError(
        `Judit API respondeu ${res.status}: ${bodyText.slice(0, 200)}`,
        res.status,
        body,
      );
    }
    return body as T;
  } catch (err) {
    if (err instanceof JuditError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new JuditError('Timeout: Judit não respondeu em 45s');
    }
    throw new JuditError(err instanceof Error ? err.message : 'Erro desconhecido');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Consulta processual por Nº CNJ.
 *
 * TODO ajustar path exato quando doc chegar. Baseado em padrão REST comum:
 *   GET /processos?cnj={cnj}
 *   OU
 *   POST /consulta-processual { cnj }
 *
 * Ambas devem retornar o payload de ProcessoJudit.
 */
export async function consultarProcesso(cnj: string): Promise<PayloadJudit> {
  const cnjLimpo = cnj.replace(/\D/g, '');
  if (cnjLimpo.length !== 20) {
    throw new JuditError('Nº CNJ deve ter 20 dígitos');
  }
  return fetchJson<PayloadJudit>(`/processos/${encodeURIComponent(cnj)}`, { method: 'GET' });
}

/**
 * Consulta histórica por CPF/CNPJ/OAB — traz TODOS os processos da pessoa/empresa.
 * Útil pra saber se o cedente tem outros processos, penhoras, etc.
 */
export async function consultarHistoricoCpf(cpf: string): Promise<PayloadJudit> {
  const cpfLimpo = cpf.replace(/\D/g, '');
  if (cpfLimpo.length !== 11 && cpfLimpo.length !== 14) {
    throw new JuditError('CPF (11) ou CNPJ (14) dígitos');
  }
  return fetchJson<PayloadJudit>(`/consultas/historico?documento=${cpfLimpo}`, { method: 'GET' });
}

/**
 * Baixar autos processuais (PDF) — feature paga separada (15 créditos no Adv).
 * TODO: implementar quando confirmarmos que temos permissão pra baixar
 *       (respeitando os "anexos privados" do processo).
 */
export async function baixarAutos(cnj: string): Promise<{ url: string }> {
  return fetchJson<{ url: string }>(`/processos/${encodeURIComponent(cnj)}/autos`, {
    method: 'GET',
  });
}

/** Retorna true se JUDIT_API_KEY tá configurada (usado pra esconder botão na UI) */
export function juditConfigurada(): boolean {
  return Boolean(process.env.JUDIT_API_KEY);
}
