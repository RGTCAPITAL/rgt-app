import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Portão das rotinas agendadas (/api/cron/*). Saiu de dentro da rotina de
 * índices quando veio a segunda (acompanhamento do DJEN): duas cópias de
 * código de segurança divergem com o tempo. Os testes de autorização seguem
 * em app/api/cron/indices/route.test.ts.
 */

/**
 * Compara o segredo sem vazar o tamanho nem o conteúdo pelo tempo.
 *
 * Medido: o sinal de uma comparação `!==` aqui é de ~32 ns, abaixo do próprio
 * desvio-padrão da medição e contra 635 ms de jitter de rede — não é
 * explorável na prática. O sha256 está aqui por higiene e porque é barato;
 * hashear os dois lados também resolve o fato de `timingSafeEqual` LANÇAR
 * quando os buffers têm tamanhos diferentes.
 */
function segredoConfere(recebido: string, esperado: string): boolean {
  const a = createHash('sha256').update(recebido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

export function autorizarCron(
  req: Request,
): { ok: true } | { ok: false; status: number; erro: string } {
  const esperado = process.env.CRON_SECRET;
  // Falha fechada: sem a env var a Vercel não manda header nenhum, e um
  // `Bearer undefined` poderia casar com um header vazio.
  if (!esperado) return { ok: false, status: 500, erro: 'cron_nao_configurado' };

  // A Vercel manda `Authorization: Bearer <CRON_SECRET>` automaticamente.
  // O header próprio existe pro disparo manual com curl.
  const auth = req.headers.get('authorization') ?? '';
  const recebido = auth.startsWith('Bearer ')
    ? auth.slice('Bearer '.length)
    : (req.headers.get('x-cron-secret') ?? '');

  if (!recebido || !segredoConfere(recebido, esperado)) {
    return { ok: false, status: 401, erro: 'nao_autorizado' };
  }
  return { ok: true };
}
