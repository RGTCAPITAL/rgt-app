import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Testes de sincronização. Nenhum toca rede nem banco.
 *
 * O caso que motivou o arquivo: quando o IBGE falha, o upsert mandava
 * `numero_indice: null` em TODAS as linhas de IPCA — 561 delas hoje, todas com
 * valor correto — e apagava o número-índice do banco inteiro. O `catch` do IBGE
 * era vazio, então não sobrava nem log.
 *
 * O prejuízo no fator é pequeno (medido: ~0,0003% em 200 meses). O que quebra é
 * o invariante que a migration 021 declara por escrito: "o valor usado num
 * cálculo não pode mudar depois". Uma linha com `coletado_em` de hoje e
 * `numero_indice` vindo de outra coleta faz a tabela de auditoria mentir.
 */

vi.mock('./bcb', () => ({
  buscarSerie: vi.fn(),
  BcbError: class BcbError extends Error {},
}));
vi.mock('./ibge', () => ({
  buscarNumeroIndiceIpca: vi.fn(),
  IbgeError: class IbgeError extends Error {},
}));

const { buscarSerie } = await import('./bcb');
const { buscarNumeroIndiceIpca } = await import('./ibge');
const { sincronizarSerie, sincronizarTodas } = await import('./sync');

/** 15/10/2026 — fixo, pra o corte de mês fechado não depender do relógio. */
const HOJE = new Date('2026-10-15T12:00:00Z');

/**
 * Captura o que foi mandado pro upsert, sem banco.
 *
 * Guarda cada chamada separadamente porque o conserto manda DOIS upserts — um
 * sem a chave `numero_indice` e outro só com as competências que têm valor — e
 * o teste precisa afirmar coisas diferentes sobre cada um.
 */
function supabaseFake(rpc?: { data?: unknown; error?: { message: string } }) {
  const chamadas: { linhas: Record<string, unknown>[]; opts: unknown }[] = [];
  const client = {
    from: () => ({
      upsert: (linhas: Record<string, unknown>[], opts: unknown) => {
        chamadas.push({ linhas, opts });
        return Promise.resolve({ error: null });
      },
    }),
    rpc: () => Promise.resolve(rpc ?? { data: [], error: null }),
  };
  // O tipo real é SupabaseClient; aqui só from().upsert() e rpc() são exercidos.
  return { client: client as never, chamadas };
}

/** Como a RPC `resumo_indices_economicos` responde pro estado real do banco. */
const RESUMO_DO_BANCO = [
  {
    serie: 'ipca',
    total: 561,
    primeira_competencia: '1980-01-01',
    ultima_competencia: '2026-09-01',
  },
  {
    serie: 'ipca_15',
    total: 317,
    primeira_competencia: '2000-05-01',
    ultima_competencia: '2026-09-01',
  },
  {
    serie: 'inpc',
    total: 570,
    primeira_competencia: '1979-04-01',
    ultima_competencia: '2026-09-01',
  },
  {
    serie: 'selic',
    total: 482,
    primeira_competencia: '1986-08-01',
    ultima_competencia: '2026-09-01',
  },
  {
    serie: 'poupanca',
    total: 172,
    primeira_competencia: '2012-06-01',
    ultima_competencia: '2026-09-01',
  },
  { serie: 'tr', total: 427, primeira_competencia: '1991-03-01', ultima_competencia: '2026-09-01' },
];

const PONTOS_BCB = [
  { competencia: '2026-07-01', valor: 0.26 },
  { competencia: '2026-08-01', valor: 0.11 },
  { competencia: '2026-09-01', valor: 0.82 },
];

beforeEach(() => {
  vi.mocked(buscarSerie).mockReset();
  vi.mocked(buscarNumeroIndiceIpca).mockReset();
});

describe('sincronizarSerie — o número-índice não pode ser apagado', () => {
  it('NÃO manda a chave numero_indice quando o IBGE falha', async () => {
    // O coração do bug. Ausente é diferente de null: o PostgREST monta o
    // `DO UPDATE SET` a partir da união das chaves de todas as linhas do lote,
    // então a chave presente com null gera `numero_indice = EXCLUDED.numero_indice`
    // e sobrescreve o valor que já estava gravado.
    vi.mocked(buscarSerie).mockResolvedValue(PONTOS_BCB);
    vi.mocked(buscarNumeroIndiceIpca).mockRejectedValue(new Error('IBGE fora do ar'));

    const { client, chamadas } = supabaseFake();
    const r = await sincronizarSerie(client, 'ipca', undefined, HOJE);

    expect(r.erro).toBeUndefined();
    expect(chamadas.length).toBe(1);
    for (const linha of chamadas[0]!.linhas) {
      expect(Object.keys(linha)).not.toContain('numero_indice');
    }
  });

  it('registra o aviso em vez de engolir a falha do IBGE', async () => {
    // O `catch` vazio foi o que tornou o bug invisível. Agora o resultado
    // carrega o motivo, e quem chama pode logar ou exibir.
    vi.mocked(buscarSerie).mockResolvedValue(PONTOS_BCB);
    vi.mocked(buscarNumeroIndiceIpca).mockRejectedValue(new Error('IBGE respondeu 503'));

    const { client } = supabaseFake();
    const r = await sincronizarSerie(client, 'ipca', undefined, HOJE);

    expect(r.avisoNumeroIndice).toContain('503');
    // Aviso não é erro: a variação mensal foi gravada e a série não regrediu.
    expect(r.erro).toBeUndefined();
    expect(r.gravados).toBe(3);
  });

  it('nunca manda numero_indice null quando o IBGE devolve só parte', async () => {
    // Caso real: o IBGE publica a variação antes do número-índice, então o mês
    // mais recente vem sem. As linhas sem valor não podem carregar a chave.
    vi.mocked(buscarSerie).mockResolvedValue(PONTOS_BCB);
    vi.mocked(buscarNumeroIndiceIpca).mockResolvedValue([
      { competencia: '2026-07-01', numeroIndice: 7421.31 },
      { competencia: '2026-08-01', numeroIndice: 7429.47 },
    ]);

    const { client, chamadas } = supabaseFake();
    const r = await sincronizarSerie(client, 'ipca', undefined, HOJE);

    expect(r.erro).toBeUndefined();
    const todas = chamadas.flatMap((c) => c.linhas);
    for (const linha of todas) {
      if ('numero_indice' in linha) {
        expect(linha.numero_indice).not.toBeNull();
        expect(typeof linha.numero_indice).toBe('number');
      }
    }
    // E as duas competências que têm número-índice chegaram com ele.
    const comIndice = todas.filter((l) => 'numero_indice' in l).map((l) => l.competencia);
    expect(comIndice.sort()).toEqual(['2026-07-01', '2026-08-01']);
  });

  it('toda linha enviada é COMPLETA, com as colunas NOT NULL', async () => {
    // Este teste existe por um bug que só a execução real revelou. A primeira
    // versão do conserto mandava um segundo lote só com
    // {serie, competencia, numero_indice}, apostando que a linha já existia e
    // cairia no UPDATE. O Postgres respondeu:
    //
    //   null value in column "variacao_pct" violates not-null constraint
    //
    // Num INSERT ... ON CONFLICT DO UPDATE a tupla candidata é montada e
    // validada ANTES de o conflito ser resolvido. Linha incompleta não passa,
    // mesmo quando a chave já existe.
    vi.mocked(buscarSerie).mockResolvedValue(PONTOS_BCB);
    vi.mocked(buscarNumeroIndiceIpca).mockResolvedValue([
      { competencia: '2026-07-01', numeroIndice: 7421.31 },
    ]);

    const { client, chamadas } = supabaseFake();
    await sincronizarSerie(client, 'ipca', undefined, HOJE);

    // Dois lotes: um com a competência que tem índice, outro com as que não têm.
    expect(chamadas.length).toBe(2);
    for (const linha of chamadas.flatMap((c) => c.linhas)) {
      expect(linha.variacao_pct).toBeTypeOf('number');
      expect(linha.fonte).toBeTypeOf('string');
      expect(linha.coletado_em).toBeTypeOf('string');
      expect(linha.serie).toBeDefined();
      expect(linha.competencia).toBeDefined();
    }
  });

  it('grava o número-índice quando o IBGE cobre tudo', async () => {
    vi.mocked(buscarSerie).mockResolvedValue(PONTOS_BCB);
    vi.mocked(buscarNumeroIndiceIpca).mockResolvedValue([
      { competencia: '2026-07-01', numeroIndice: 7421.31 },
      { competencia: '2026-08-01', numeroIndice: 7429.47 },
      { competencia: '2026-09-01', numeroIndice: 7490.39 },
    ]);

    const { client, chamadas } = supabaseFake();
    const r = await sincronizarSerie(client, 'ipca', undefined, HOJE);

    expect(r.gravados).toBe(3);
    expect(r.avisoNumeroIndice).toBeUndefined();
    const comIndice = chamadas.flatMap((c) => c.linhas).filter((l) => 'numero_indice' in l);
    expect(comIndice.length).toBe(3);
  });

  it('não chama o IBGE pra série que não tem número-índice', async () => {
    // Só o IPCA tem. Chamar pras outras 5 seria 5 requests por rodada à toa.
    vi.mocked(buscarSerie).mockResolvedValue(PONTOS_BCB);

    const { client, chamadas } = supabaseFake();
    await sincronizarSerie(client, 'selic', undefined, HOJE);

    expect(buscarNumeroIndiceIpca).not.toHaveBeenCalled();
    for (const linha of chamadas[0]!.linhas) {
      expect(Object.keys(linha)).not.toContain('numero_indice');
    }
  });
});

describe('sincronizarSerie — mês em curso', () => {
  it('descarta a competência do mês corrente', async () => {
    // A série 4390 devolve o mês em curso ainda acumulando (out/2026 = 0,56
    // contra set = 1,08). Gravar faria a correção sair a menor, e o erro
    // ficaria congelado no snapshot.
    vi.mocked(buscarSerie).mockResolvedValue([
      ...PONTOS_BCB,
      { competencia: '2026-10-01', valor: 0.56 },
    ]);

    const { client, chamadas } = supabaseFake();
    const r = await sincronizarSerie(client, 'selic', undefined, HOJE);

    expect(r.ultimaCompetencia).toBe('2026-09-01');
    const competencias = chamadas.flatMap((c) => c.linhas).map((l) => l.competencia);
    expect(competencias).not.toContain('2026-10-01');
  });

  it('não grava nada quando só veio o mês aberto', async () => {
    vi.mocked(buscarSerie).mockResolvedValue([{ competencia: '2026-10-01', valor: 0.56 }]);

    const { client, chamadas } = supabaseFake();
    const r = await sincronizarSerie(client, 'selic', undefined, HOJE);

    expect(r.gravados).toBe(0);
    expect(chamadas.length).toBe(0);
  });
});

describe('sincronizarSerie — falha do BCB', () => {
  it('devolve erro na série sem lançar', async () => {
    // Uma série que falha não pode derrubar as outras cinco.
    // Esperas zeradas: sem isso o retry dorme 7 s de verdade neste teste.
    vi.mocked(buscarSerie).mockRejectedValue(new Error('BCB respondeu 404'));

    const { client, chamadas } = supabaseFake();
    const r = await sincronizarSerie(client, 'inpc', undefined, HOJE, [0, 0, 0]);

    expect(r.erro).toContain('404');
    expect(r.gravados).toBe(0);
    expect(chamadas.length).toBe(0);
  });
});

describe('sincronizarSerie — retry', () => {
  // Esperas zeradas: o teste verifica o número de tentativas, não o relógio.
  const SEM_ESPERA = [0, 0, 0];

  it('sucede na terceira tentativa depois de duas falhas transientes', async () => {
    // O modo de falha real do SGS: a mesma URL voltou em ~300 ms na tentativa
    // seguinte. Sem retry, isso custa um dia de atraso — a Vercel não retenta.
    vi.mocked(buscarSerie)
      .mockRejectedValueOnce(new Error('BCB devolveu text/html em vez de JSON'))
      .mockRejectedValueOnce(new Error('BCB respondeu 502'))
      .mockResolvedValueOnce(PONTOS_BCB);
    vi.mocked(buscarNumeroIndiceIpca).mockResolvedValue([]);

    const { client } = supabaseFake();
    const r = await sincronizarSerie(client, 'selic', undefined, HOJE, SEM_ESPERA);

    expect(r.erro).toBeUndefined();
    expect(r.gravados).toBe(3);
    expect(buscarSerie).toHaveBeenCalledTimes(3);
  });

  it('desiste depois de três falhas e devolve o último erro', async () => {
    vi.mocked(buscarSerie).mockRejectedValue(new Error('BCB respondeu 404'));

    const { client } = supabaseFake();
    const r = await sincronizarSerie(client, 'inpc', undefined, HOJE, SEM_ESPERA);

    expect(r.erro).toContain('404');
    expect(buscarSerie).toHaveBeenCalledTimes(3);
  });

  it('não retenta quando deu certo de primeira', async () => {
    vi.mocked(buscarSerie).mockResolvedValue(PONTOS_BCB);
    vi.mocked(buscarNumeroIndiceIpca).mockResolvedValue([]);

    const { client } = supabaseFake();
    await sincronizarSerie(client, 'tr', undefined, HOJE, SEM_ESPERA);

    expect(buscarSerie).toHaveBeenCalledTimes(1);
  });

  it('uma série esgotada não derruba as outras cinco', async () => {
    // Falha parcial é o caso normal, não borda: 5 séries gravam e 1 falha.
    vi.mocked(buscarSerie).mockImplementation((serie) =>
      serie === 'inpc'
        ? Promise.reject(new Error('BCB respondeu 502'))
        : Promise.resolve(PONTOS_BCB),
    );
    vi.mocked(buscarNumeroIndiceIpca).mockResolvedValue([]);

    const { client } = supabaseFake();
    const r = await sincronizarTodas(client, {
      tipo: 'completa',
      hoje: HOJE,
      esperasMs: SEM_ESPERA,
    });

    expect(r.filter((x) => x.erro).map((x) => x.serie)).toEqual(['inpc']);
    expect(r.filter((x) => !x.erro).length).toBe(5);
  });
});

describe('sincronizarTodas — janela', () => {
  it('modo completa (o default) pede desde o início do catálogo', async () => {
    // O botão do admin não passa opções. O comportamento dele não pode mudar:
    // quem clica "Sincronizar" espera carga cheia, não otimização silenciosa.
    vi.mocked(buscarSerie).mockResolvedValue(PONTOS_BCB);
    vi.mocked(buscarNumeroIndiceIpca).mockResolvedValue([]);

    const { client } = supabaseFake();
    await sincronizarTodas(client);

    // Cada série parte do próprio início de catálogo, não de uma data comum —
    // é o que distingue a carga completa da janela incremental, onde todas
    // convergem pra mesma competência recuada.
    const porSerie = new Map(vi.mocked(buscarSerie).mock.calls.map((c) => [c[0], c[1]]));
    expect(porSerie.get('ipca')).toBe('1980-01-01');
    expect(porSerie.get('inpc')).toBe('1979-04-01');
    expect(porSerie.get('poupanca')).toBe('2012-06-01');
    expect(porSerie.get('tr')).toBe('1991-03-01');
  });

  it('modo incremental deriva a janela da última competência do BANCO', async () => {
    // Banco em set/2026 e sobreposição de 3 → jun/2026, pra todas as séries.
    vi.mocked(buscarSerie).mockResolvedValue(PONTOS_BCB);
    vi.mocked(buscarNumeroIndiceIpca).mockResolvedValue([]);

    const { client } = supabaseFake({ data: RESUMO_DO_BANCO, error: undefined });
    await sincronizarTodas(client, { tipo: 'incremental', hoje: HOJE });

    const inicios = vi.mocked(buscarSerie).mock.calls.map((c) => c[1]);
    expect(inicios).toEqual(Array(6).fill('2026-06-01'));
  });

  it('nunca pede a partir da competência seguinte à última', async () => {
    // Medido ao vivo em 19/10/2026 com dataInicial=01/10/2026: IPCA devolve
    // HTTP 200 com corpo {"erro":{}} e IPCA-15/INPC devolvem HTTP 404. Os três
    // viram BcbError e derrubam a série — todo dia, do dia 1 ao 11 do mês.
    vi.mocked(buscarSerie).mockResolvedValue(PONTOS_BCB);
    vi.mocked(buscarNumeroIndiceIpca).mockResolvedValue([]);

    const { client } = supabaseFake({ data: RESUMO_DO_BANCO, error: undefined });
    await sincronizarTodas(client, { tipo: 'incremental', hoje: HOJE });

    for (const chamada of vi.mocked(buscarSerie).mock.calls) {
      expect(chamada[1]! < '2026-09-01').toBe(true);
    }
  });

  it('LANÇA quando a RPC do resumo falha, em vez de cair pro completo', async () => {
    // Cair em silêncio seria pior: o job voltaria a reescrever 2.529 linhas por
    // dia e ninguém saberia por quê.
    const { client } = supabaseFake({ data: null, error: { message: 'PGRST202' } });

    await expect(sincronizarTodas(client, { tipo: 'incremental', hoje: HOJE })).rejects.toThrow(
      /resumo/i,
    );
  });

  it('banco vazio no incremental vira bootstrap, não erro', async () => {
    // Primeira execução num ambiente novo: a RPC não devolve linha nenhuma.
    vi.mocked(buscarSerie).mockResolvedValue(PONTOS_BCB);
    vi.mocked(buscarNumeroIndiceIpca).mockResolvedValue([]);

    const { client } = supabaseFake({ data: [], error: undefined });
    const r = await sincronizarTodas(client, { tipo: 'incremental', hoje: HOJE });

    expect(r.length).toBe(6);
    expect(r.every((x) => !x.erro)).toBe(true);
    // Pediu desde o início de cada catálogo, não desde uma data inventada.
    const inicios = vi.mocked(buscarSerie).mock.calls.map((c) => c[1]);
    expect(inicios).toContain('1980-01-01');
    expect(inicios).toContain('1979-04-01');
  });
});
