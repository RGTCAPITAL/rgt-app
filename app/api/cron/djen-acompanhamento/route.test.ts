import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A rotina é pública no proxy e o repositório é público: sem o segredo, a URL
 * conhecida gastaria a cota do CNJ da RGT. O portão em si tem bateria completa
 * em ../indices/route.test.ts; aqui só se garante que esta rota usa ele.
 */

vi.mock('@/lib/djen/acompanhamento', () => ({ acompanharProcessos: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn(() => ({})) }));

const { acompanharProcessos } = await import('@/lib/djen/acompanhamento');
const { GET } = await import('./route');

const SEGREDO = 'a'.repeat(64);
const URL_ROTA = 'https://rgt.example/api/cron/djen-acompanhamento';

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SEGREDO);
  vi.mocked(acompanharProcessos).mockResolvedValue({
    acompanhados: 3,
    verificados: 3,
    comNovidade: 1,
    linhaDeBase: 0,
    avisos: 2,
    tarefas: 0,
    falhas: 0,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('cron do acompanhamento do DJEN', () => {
  it('sem segredo → 401 e não consulta o DJEN', async () => {
    const r = await GET(new Request(URL_ROTA));
    expect(r.status).toBe(401);
    expect(acompanharProcessos).not.toHaveBeenCalled();
  });

  it('com o Bearer da Vercel → roda e devolve o resumo', async () => {
    const r = await GET(new Request(URL_ROTA, { headers: { authorization: `Bearer ${SEGREDO}` } }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ verificados: 3, avisos: 2 });
  });

  it('erro inesperado → 500 sem vazar a mensagem', async () => {
    vi.mocked(acompanharProcessos).mockRejectedValue(new Error('relation "djen_x" does not exist'));
    const r = await GET(new Request(URL_ROTA, { headers: { authorization: `Bearer ${SEGREDO}` } }));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('djen_x');
  });

  it('tudo falhou → 500; falha parcial → 200', async () => {
    const autorizado = { headers: { authorization: `Bearer ${SEGREDO}` } };
    vi.mocked(acompanharProcessos).mockResolvedValue({
      acompanhados: 2,
      verificados: 0,
      comNovidade: 0,
      linhaDeBase: 0,
      avisos: 0,
      tarefas: 0,
      falhas: 2,
    });
    expect((await GET(new Request(URL_ROTA, autorizado))).status).toBe(500);

    vi.mocked(acompanharProcessos).mockResolvedValue({
      acompanhados: 2,
      verificados: 1,
      comNovidade: 0,
      linhaDeBase: 1,
      avisos: 0,
      tarefas: 0,
      falhas: 1,
    });
    expect((await GET(new Request(URL_ROTA, autorizado))).status).toBe(200);
  });
});
