/**
 * Rate limiter serial pra API do DJEN.
 *
 * A API declara `X-RateLimit-Limit: 20` por minuto (rolling window). Nós
 * mantemos ~18 req/min efetivos = intervalo mínimo de 3.3s entre requests,
 * o que dá 2 de folga contra o teto do servidor.
 *
 * Por que não usar `X-RateLimit-Remaining` como budget?
 *   Observamos ele subir de 15 → 20 entre requests seguidos, então flutua
 *   não-monotonicamente. Serve só como sinal: quando remaining <= 3, espera
 *   65s (dá tempo do rolling window rolar).
 */

const INTERVALO_MS = 3300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simples e sem estado global — instanciar uma por processo/worker. Se
 * duas instâncias rodam em paralelo, cada uma respeita 18/min mas o total
 * do servidor pode passar de 20/min. Pra futuro: mover pra Redis se
 * chegarmos em multi-worker.
 */
export class DjenRateLimiter {
  private ultimoRequest = 0;

  async esperar(remainingAnterior?: number | null): Promise<void> {
    if (remainingAnterior !== undefined && remainingAnterior !== null && remainingAnterior <= 3) {
      // Sinal de esgotamento — espera o rolling window rolar (60s + folga)
      await sleep(65_000);
      this.ultimoRequest = Date.now();
      return;
    }

    const agora = Date.now();
    const desde = agora - this.ultimoRequest;
    if (desde < INTERVALO_MS) {
      await sleep(INTERVALO_MS - desde);
    }
    this.ultimoRequest = Date.now();
  }
}
