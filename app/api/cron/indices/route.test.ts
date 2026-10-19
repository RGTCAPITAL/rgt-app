import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Testes do endpoint agendado. Nenhum toca rede, banco ou relógio real.
 *
 * O que estes testes protegem, em ordem de gravidade:
 *
 *  1. Que a sincronização NÃO roda sem o segredo. A rota é pública no proxy
 *     (tem que ser — ver proxy.test.ts) e o repo é público, então a URL é
 *     conhecimento público. Cada chamada dispara 7 requests às APIs do BCB e do
 *     IBGE: sem o gate, o endpoint vira amplificador contra terceiro.
 *  2. Que o corpo da resposta não vaza mensagem de erro do Supabase, que traz
 *     nome de tabela, nome de coluna e SQLSTATE.
 *  3. Que falha parcial não é tratada como falha total.
 */

vi.mock('@/lib/indices/sync', () => ({ sincronizarTodas: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn(() => ({})) }));

const { sincronizarTodas } = await import('@/lib/indices/sync');
const { GET, POST } = await import('./route');

const SEGREDO = 'f'.repeat(64);
const URL_BASE = 'https://rgt.example/api/cron/indices';

const SUCESSO = [
  { serie: 'ipca', gravados: 4, ultimaCompetencia: '2026-09-01' },
  { serie: 'ipca_15', gravados: 4, ultimaCompetencia: '2026-09-01' },
  { serie: 'inpc', gravados: 4, ultimaCompetencia: '2026-09-01' },
  { serie: 'selic', gravados: 5, ultimaCompetencia: '2026-09-01' },
  { serie: 'poupanca', gravados: 5, ultimaCompetencia: '2026-09-01' },
  { serie: 'tr', gravados: 5, ultimaCompetencia: '2026-09-01' },
];

function req(headers: Record<string, string> = {}, url = URL_BASE) {
  return new Request(url, { headers });
}

const comBearer = () => req({ authorization: `Bearer ${SEGREDO}` });

beforeEach(() => {
  vi.mocked(sincronizarTodas).mockReset();
  vi.mocked(sincronizarTodas).mockResolvedValue(SUCESSO as never);
  process.env.CRON_SECRET = SEGREDO;
  // 19/10 → fora da janela de carga completa, então o default é incremental.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CRON_SECRET;
});

describe('autorização', () => {
  it('sem header nenhum → 401 e NÃO sincroniza', async () => {
    // O "e não sincroniza" é a metade que importa: um 401 depois de já ter
    // batido 7 vezes no BCB não protege ninguém.
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ erro: 'nao_autorizado' });
    expect(sincronizarTodas).not.toHaveBeenCalled();
  });

  it('segredo errado → 401 e não sincroniza', async () => {
    const res = await GET(req({ authorization: `Bearer ${'a'.repeat(64)}` }));
    expect(res.status).toBe(401);
    expect(sincronizarTodas).not.toHaveBeenCalled();
  });

  it('segredo de tamanho diferente → 401, sem lançar', async () => {
    // `timingSafeEqual` LANÇA com buffers de tamanhos diferentes. Hashear os
    // dois lados resolve; sem isso este teste viraria 500 pelo motivo errado.
    const res = await GET(req({ authorization: 'Bearer curto' }));
    expect(res.status).toBe(401);
  });

  it('Authorization sem o prefixo Bearer não passa', async () => {
    const res = await GET(req({ authorization: SEGREDO }));
    expect(res.status).toBe(401);
  });

  it('aceita o header próprio, pro disparo manual', async () => {
    const res = await GET(req({ 'x-cron-secret': SEGREDO }));
    expect(res.status).toBe(200);
  });

  it('aceita o Bearer que a Vercel manda', async () => {
    const res = await GET(comBearer());
    expect(res.status).toBe(200);
    expect(sincronizarTodas).toHaveBeenCalledTimes(1);
  });

  it('sem CRON_SECRET no ambiente → 500 e não sincroniza', async () => {
    // Falha fechada. Se a env var não existe, a Vercel não manda header
    // nenhum — tratar isso como "autorizado" abriria a rota pra qualquer um.
    delete process.env.CRON_SECRET;
    const res = await GET(comBearer());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ erro: 'cron_nao_configurado' });
    expect(sincronizarTodas).not.toHaveBeenCalled();
  });

  it('POST passa pelo mesmo gate', async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(sincronizarTodas).not.toHaveBeenCalled();
  });
});

describe('modo', () => {
  it('fora dos primeiros dias do mês → incremental', async () => {
    await GET(comBearer());
    expect(vi.mocked(sincronizarTodas).mock.calls[0]![1]).toMatchObject({ tipo: 'incremental' });
  });

  it('nos dois primeiros dias do mês → completa', async () => {
    // A carga completa captura revisão de valor antigo, que a sobreposição de
    // 3 meses não alcança. Dois dias porque a entrega da Vercel é best-effort.
    vi.setSystemTime(new Date('2026-11-01T15:00:00Z'));
    await GET(comBearer());
    expect(vi.mocked(sincronizarTodas).mock.calls[0]![1]).toMatchObject({ tipo: 'completa' });

    vi.mocked(sincronizarTodas).mockClear();
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));
    await GET(comBearer());
    expect(vi.mocked(sincronizarTodas).mock.calls[0]![1]).toMatchObject({ tipo: 'completa' });

    vi.mocked(sincronizarTodas).mockClear();
    vi.setSystemTime(new Date('2026-11-03T15:00:00Z'));
    await GET(comBearer());
    expect(vi.mocked(sincronizarTodas).mock.calls[0]![1]).toMatchObject({ tipo: 'incremental' });
  });

  it('?modo=completo força a carga completa', async () => {
    await GET(req({ authorization: `Bearer ${SEGREDO}` }, `${URL_BASE}?modo=completo`));
    expect(vi.mocked(sincronizarTodas).mock.calls[0]![1]).toMatchObject({ tipo: 'completa' });
  });

  it('?modo=incremental força o incremental mesmo no dia 1', async () => {
    vi.setSystemTime(new Date('2026-11-01T15:00:00Z'));
    await GET(req({ authorization: `Bearer ${SEGREDO}` }, `${URL_BASE}?modo=incremental`));
    expect(vi.mocked(sincronizarTodas).mock.calls[0]![1]).toMatchObject({ tipo: 'incremental' });
  });
});

describe('resposta', () => {
  it('6 de 6 → 200 com as competências por série', async () => {
    const res = await GET(comBearer());
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.ok).toBe(true);
    expect(corpo.parcial).toBe(false);
    expect(corpo.series.length).toBe(6);
    expect(corpo.series[0].ultimaCompetencia).toBe('2026-09-01');
  });

  it('falha parcial → 200, marcado como parcial', async () => {
    // Cinco séries atualizadas é sucesso com ressalva. Devolver 500 faria cada
    // blip transiente parecer falha total — e quem avisa que UMA série está
    // envelhecendo é o selo de frescor do painel, que é por série.
    vi.mocked(sincronizarTodas).mockResolvedValue([
      ...SUCESSO.slice(0, 5),
      { serie: 'tr', gravados: 0, ultimaCompetencia: null, erro: 'BCB respondeu 502' },
    ] as never);

    const res = await GET(comBearer());
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.parcial).toBe(true);
    expect(corpo.falhas).toBe(1);
    expect(corpo.series.find((s: { serie: string }) => s.serie === 'tr').falhou).toBe(true);
  });

  it('todas falharam → 500', async () => {
    vi.mocked(sincronizarTodas).mockResolvedValue(
      SUCESSO.map((s) => ({ ...s, gravados: 0, erro: 'BCB respondeu 502' })) as never,
    );
    const res = await GET(comBearer());
    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBe(false);
  });

  it('NUNCA devolve a mensagem de erro no corpo', async () => {
    // As mensagens do Supabase trazem nome de tabela, nome de coluna e
    // SQLSTATE. Numa rota pública isso é oráculo de enumeração de schema.
    vi.mocked(sincronizarTodas).mockResolvedValue([
      ...SUCESSO.slice(0, 5),
      {
        serie: 'tr',
        gravados: 0,
        ultimaCompetencia: null,
        erro: 'column indices_economicos.variacao_pct does not exist (PGRST205)',
      },
    ] as never);

    const texto = await (await GET(comBearer())).text();

    expect(texto).not.toContain('PGRST205');
    expect(texto).not.toContain('indices_economicos');
    expect(texto).not.toContain('does not exist');
    // Mas o fato de ter falhado aparece.
    expect(texto).toContain('"falhou":true');
  });

  it('sinaliza a série que ficou sem número-índice', async () => {
    vi.mocked(sincronizarTodas).mockResolvedValue([
      { ...SUCESSO[0], avisoNumeroIndice: 'IBGE respondeu 503' },
      ...SUCESSO.slice(1),
    ] as never);

    const corpo = await (await GET(comBearer())).json();
    expect(corpo.series[0].semNumeroIndice).toBe(true);
    // Aviso não é falha: a variação entrou e a série não regrediu.
    expect(corpo.series[0].falhou).toBe(false);
    expect(corpo.ok).toBe(true);
  });

  it('a exceção do planejador de janela vira 500 sem vazar detalhe', async () => {
    // `sincronizarTodas` lança quando a RPC do resumo falha — de propósito, pra
    // não cair pro modo completo em silêncio.
    vi.mocked(sincronizarTodas).mockRejectedValue(
      new Error('Não consegui ler o resumo das séries: PGRST202 function does not exist'),
    );

    const res = await GET(comBearer());
    const texto = await res.text();

    expect(res.status).toBe(500);
    expect(texto).not.toContain('PGRST202');
    expect(JSON.parse(texto).erro).toBe('falha_na_sincronizacao');
  });
});
