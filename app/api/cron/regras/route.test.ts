import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A rotina é pública no proxy e o repositório é público: sem o segredo, a URL
 * conhecida viraria um jeito de qualquer um criar tarefa pra equipe inteira.
 * O portão em si tem bateria completa em ../indices/route.test.ts; aqui só se
 * garante que esta rota usa ele e que o status reflete o resultado.
 */

vi.mock('@/lib/regras/executar', () => ({ rodarRegrasDeLead: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn(() => ({})) }));

const { rodarRegrasDeLead } = await import('@/lib/regras/executar');
const { GET } = await import('./route');

const SEGREDO = 'b'.repeat(64);
const URL_ROTA = 'https://rgt.example/api/cron/regras';
const autorizado = { headers: { authorization: `Bearer ${SEGREDO}` } };

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SEGREDO);
  vi.mocked(rodarRegrasDeLead).mockResolvedValue({
    regrasLigadas: ['follow_up', 'lead_parado'],
    leadsAnalisados: 9,
    tarefasCriadas: 2,
    jaExistiam: 1,
    falhas: 0,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('cron das regras automáticas', () => {
  it('sem segredo → 401 e não roda as regras', async () => {
    const r = await GET(new Request(URL_ROTA));
    expect(r.status).toBe(401);
    expect(rodarRegrasDeLead).not.toHaveBeenCalled();
  });

  it('com o Bearer da Vercel → roda e devolve o resumo', async () => {
    const r = await GET(new Request(URL_ROTA, autorizado));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ tarefasCriadas: 2, jaExistiam: 1 });
  });

  it('erro inesperado → 500 sem vazar a mensagem', async () => {
    vi.mocked(rodarRegrasDeLead).mockRejectedValue(new Error('leads: column "status_desde" x'));
    const r = await GET(new Request(URL_ROTA, autorizado));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('status_desde');
  });

  it('tudo falhou → 500; falha parcial → 200', async () => {
    vi.mocked(rodarRegrasDeLead).mockResolvedValue({
      regrasLigadas: ['follow_up'],
      leadsAnalisados: 3,
      tarefasCriadas: 0,
      jaExistiam: 0,
      falhas: 2,
    });
    expect((await GET(new Request(URL_ROTA, autorizado))).status).toBe(500);

    vi.mocked(rodarRegrasDeLead).mockResolvedValue({
      regrasLigadas: ['follow_up'],
      leadsAnalisados: 3,
      tarefasCriadas: 1,
      jaExistiam: 0,
      falhas: 1,
    });
    expect((await GET(new Request(URL_ROTA, autorizado))).status).toBe(200);
  });

  it('nada ligado → 200 sem tarefa nenhuma', async () => {
    vi.mocked(rodarRegrasDeLead).mockResolvedValue({
      regrasLigadas: [],
      leadsAnalisados: 0,
      tarefasCriadas: 0,
      jaExistiam: 0,
      falhas: 0,
    });
    expect((await GET(new Request(URL_ROTA, autorizado))).status).toBe(200);
  });
});
