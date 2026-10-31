import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lerConfig, TUDO_DESLIGADO } from '@/lib/regras/decidir';
import type { Publicacao } from './types';

/**
 * A regra automática "processo andou" dentro da rotina do DJEN, com o DJEN e
 * o Supabase falsos. O que se protege aqui:
 *  - com a regra desligada, a rotina faz exatamente o que fazia antes;
 *  - a tarefa é criada ANTES de gravar as publicações (se falhar, amanhã
 *    elas continuam "novas" e a tarefa sai);
 *  - lead perdido "sem ofício" só gera a tarefa de reavaliar, nunca o aviso.
 * Dados fictícios.
 */

vi.mock('./client', () => ({ buscarPorCnj: vi.fn() }));
vi.mock('./mappers', () => ({ paraLinhaBanco: (p: { id: number }) => ({ id: p.id }) }));

const { buscarPorCnj } = await import('./client');
const { acompanharProcessos } = await import('./acompanhamento');

const CNJ_ATIVO = '00011073320175190001';
const CNJ_PERDIDO = '00022223320175190002';
const AGORA = Date.parse('2026-11-10T11:30:00Z');
const LIGADA = lerConfig([{ chave: 'processo_andou', ativa: true, parametros: {} }]);

function pub(id: number, data: string, codigos: string[] = []): Publicacao {
  return {
    id,
    dataDisponibilizacao: data,
    tipoDocumento: 'Despacho',
    tipoComunicacao: 'Intimação',
    redFlags: codigos.map((codigo) => ({ codigo })),
  } as unknown as Publicacao;
}

type Dados = {
  leads?: Record<string, unknown>[];
  perdidos?: Record<string, unknown>[];
  vistos?: Record<string, unknown>[];
  /** Publicações já salvas por processo: só o id, ou o id com a data. */
  conhecidas?: Record<string, (number | { id: number; data_disponibilizacao: string })[]>;
  abertas?: Record<string, unknown>[];
  ativos?: string[];
  rpc?: () => { data: unknown; error: { message: string } | null };
};

/** Registra, em ordem, o que a rotina pediu ao banco. */
function sbFake(d: Dados) {
  const log: { tabela: string; acao: string; dados?: unknown }[] = [];
  const from = (tabela: string) => {
    const filtros: unknown[][] = [];
    log.push({ tabela, acao: 'from' });
    const linhas = (): unknown[] => {
      const eq = (c: string) => filtros.find((f) => f[0] === 'eq' && f[1] === c)?.[2];
      switch (tabela) {
        case 'leads':
          return eq('status') === 'perdido' ? (d.perdidos ?? []) : (d.leads ?? []);
        case 'djen_acompanhamento':
          return d.vistos ?? [];
        case 'djen_publicacoes':
          return (d.conhecidas?.[eq('numero_processo') as string] ?? []).map((c) =>
            typeof c === 'number' ? { id: c } : c,
          );
        case 'regras_disparos':
          return d.abertas ?? [];
        case 'usuarios':
          return (d.ativos ?? []).map((id) => ({ id }));
        default:
          return [];
      }
    };
    const b: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'in', 'not']) {
      b[op] = (...args: unknown[]) => {
        filtros.push([op, ...args]);
        return b;
      };
    }
    b.upsert = (dados: unknown) => {
      log.push({ tabela, acao: 'upsert', dados });
      return Promise.resolve({ error: null });
    };
    b.insert = (dados: unknown) => {
      log.push({ tabela, acao: 'insert', dados });
      return Promise.resolve({ error: null });
    };
    b.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) =>
      Promise.resolve({ data: linhas(), error: null }).then(ok, erro);
    return b;
  };
  const rpc = (nome: string, args: Record<string, unknown>) => {
    log.push({ tabela: nome, acao: 'rpc', dados: args });
    return Promise.resolve(d.rpc ? d.rpc() : { data: 'tarefa-nova', error: null });
  };
  return { sb: { from, rpc } as never, log };
}

const LEAD_ATIVO = {
  id: 'lead-1',
  nome: 'Ana Souza',
  numero_processo: '0001107-33.2017.5.19.0001',
  dono_id: 'broker-1',
};
const JA_VISTO = {
  vistos: [{ numero_processo: CNJ_ATIVO, verificado_em: '2026-11-01T11:00:00Z' }],
  conhecidas: { [CNJ_ATIVO]: [400] },
};

const rodar = (sb: never, config = LIGADA, limite?: number) =>
  acompanharProcessos(sb, { config, limite, agora: () => AGORA, prazoMs: 60_000 });

const rpcs = (log: { acao: string; dados?: unknown }[]) =>
  log.filter((l) => l.acao === 'rpc').map((l) => l.dados as Record<string, unknown>);

beforeEach(() => {
  vi.mocked(buscarPorCnj).mockReset();
  vi.mocked(buscarPorCnj).mockResolvedValue([pub(501, '2026-11-09'), pub(400, '2026-09-01')]);
});

describe('acompanhamento do DJEN com a regra "processo andou"', () => {
  it('regra desligada: aviso como antes, sem tarefa e sem olhar perdidos', async () => {
    const { sb, log } = sbFake({ leads: [LEAD_ATIVO], ...JA_VISTO, ativos: ['broker-1'] });
    const r = await rodar(sb, TUDO_DESLIGADO);

    expect(r).toMatchObject({ comNovidade: 1, avisos: 1, tarefas: 0, falhas: 0 });
    expect(rpcs(log)).toEqual([]);
    expect(log.some((l) => l.tabela === 'regras_disparos')).toBe(false);
    expect(log.filter((l) => l.tabela === 'leads' && l.acao === 'from')).toHaveLength(1);
  });

  it('regra ligada: cria a tarefa antes de gravar as publicações, e o aviso continua', async () => {
    const { sb, log } = sbFake({ leads: [LEAD_ATIVO], ...JA_VISTO, ativos: ['broker-1'] });
    const r = await rodar(sb);

    expect(r).toMatchObject({ tarefas: 1, avisos: 1, falhas: 0 });
    expect(rpcs(log)[0]).toMatchObject({
      p_regra: 'processo_andou',
      p_chave_ciclo: 'processo_andou:lead:lead-1:501',
      p_titulo: 'Ler publicação nova no Diário',
      p_lead_id: 'lead-1',
      p_destinatario_id: 'broker-1',
      p_prazo: '2026-11-10',
    });
    const iRpc = log.findIndex((l) => l.acao === 'rpc');
    const iUpsert = log.findIndex((l) => l.tabela === 'djen_publicacoes' && l.acao === 'upsert');
    expect(iRpc).toBeGreaterThan(-1);
    expect(iRpc).toBeLessThan(iUpsert);
  });

  it('publicação antiga que o DJEN trouxe só agora não vira tarefa (corte pela data)', async () => {
    // Verificado em 01/11; o DJEN devolve uma de 12/11/2025 que ainda não
    // estava salva. Pelo id ela é "nova"; pela data, não.
    vi.mocked(buscarPorCnj).mockResolvedValue([pub(900, '2025-11-12'), pub(400, '2026-09-01')]);
    const { sb, log } = sbFake({ leads: [LEAD_ATIVO], ...JA_VISTO, ativos: ['broker-1'] });
    const r = await rodar(sb);
    expect(r.tarefas).toBe(0);
    expect(rpcs(log)).toEqual([]);
    // Nem aviso no sino: a antiga é gravada (vira conhecida) e fica quieta.
    expect(r.avisos).toBe(0);
    expect(log.some((l) => l.tabela === 'notificacoes')).toBe(false);
  });

  it('processo da Prospecção: o que saiu desde a última publicação salva vira tarefa', async () => {
    // Salvo pela Prospecção (01/10) e nunca verificado pela rotina. A cessão de
    // 20/10 é novidade; a de 12/11/2025 que o DJEN trouxe só agora, não.
    vi.mocked(buscarPorCnj).mockResolvedValue([
      pub(510, '2026-10-20'),
      pub(900, '2025-11-12'),
      pub(400, '2026-10-01'),
    ]);
    const { sb, log } = sbFake({
      leads: [LEAD_ATIVO],
      conhecidas: { [CNJ_ATIVO]: [{ id: 400, data_disponibilizacao: '2026-10-01' }] },
      ativos: ['broker-1'],
    });
    const r = await rodar(sb);
    expect(r).toMatchObject({ tarefas: 1, avisos: 1 });
    expect(rpcs(log)[0]).toMatchObject({ p_chave_ciclo: 'processo_andou:lead:lead-1:510' });
    expect(String(rpcs(log)[0]!.p_descricao)).not.toContain('12/11/2025');
  });

  it('dono inativo: a tarefa vai pra gestão', async () => {
    const { sb, log } = sbFake({ leads: [LEAD_ATIVO], ...JA_VISTO, ativos: [] });
    await rodar(sb);
    expect(rpcs(log)[0]).toMatchObject({
      p_destinatario_id: null,
      p_destinatario_perfil: 'gestao',
    });
  });

  it('já tem tarefa aberta da regra pro alvo: não cria outra', async () => {
    const { sb, log } = sbFake({
      leads: [LEAD_ATIVO],
      ...JA_VISTO,
      ativos: ['broker-1'],
      abertas: [{ lead_id: 'lead-1', operacao_id: null }],
    });
    const r = await rodar(sb);
    expect(rpcs(log)).toEqual([]);
    expect(r).toMatchObject({ tarefas: 0, avisos: 1 });
  });

  it('RPC devolvendo null (já feito): não conta tarefa e não é falha', async () => {
    const { sb } = sbFake({
      leads: [LEAD_ATIVO],
      ...JA_VISTO,
      ativos: ['broker-1'],
      rpc: () => ({ data: null, error: null }),
    });
    expect(await rodar(sb)).toMatchObject({ tarefas: 0, falhas: 0, avisos: 1 });
  });

  it('erro na RPC: o processo conta como falha e as publicações não são gravadas', async () => {
    const { sb, log } = sbFake({
      leads: [LEAD_ATIVO],
      ...JA_VISTO,
      ativos: ['broker-1'],
      rpc: () => ({ data: null, error: { message: 'deadlock' } }),
    });
    const r = await rodar(sb);
    expect(r).toMatchObject({ falhas: 1, verificados: 0 });
    expect(log.some((l) => l.tabela === 'djen_publicacoes' && l.acao === 'upsert')).toBe(false);
  });

  it('perdido sem ofício com X1 na linha de base: tarefa de reavaliar, sem aviso', async () => {
    vi.mocked(buscarPorCnj).mockResolvedValue([pub(700, '2026-11-05', ['X1'])]);
    const { sb, log } = sbFake({
      perdidos: [
        {
          id: 'lead-9',
          nome: 'Bia Lima',
          numero_processo: CNJ_PERDIDO,
          dono_id: 'broker-1',
          status_desde: '2026-10-21T01:00:00Z',
        },
      ],
      ativos: ['broker-1'],
    });
    const r = await rodar(sb);

    expect(r).toMatchObject({ linhaDeBase: 1, tarefas: 1, avisos: 0 });
    expect(rpcs(log)[0]).toMatchObject({
      p_titulo: 'Reavaliar lead perdido: o Diário cita ofício requisitório',
      p_chave_ciclo: 'reavaliar_perdido:lead-9:2026-10-21T01:00:00.000Z:2026-11-05',
    });
    expect(log.some((l) => l.tabela === 'notificacoes')).toBe(false);
  });

  it('"Ler publicação" esquecida de quando era ativo não cala o reavaliar', async () => {
    vi.mocked(buscarPorCnj).mockResolvedValue([pub(700, '2026-11-05', ['X1'])]);
    const perdido = {
      id: 'lead-9',
      nome: 'Bia Lima',
      numero_processo: CNJ_PERDIDO,
      dono_id: 'broker-1',
      status_desde: '2026-10-21T01:00:00Z',
    };
    const ler = {
      lead_id: 'lead-9',
      operacao_id: null,
      chave_ciclo: 'processo_andou:lead:lead-9:600',
    };
    const { sb, log } = sbFake({ perdidos: [perdido], ativos: ['broker-1'], abertas: [ler] });
    expect(await rodar(sb)).toMatchObject({ tarefas: 1 });
    expect(String(rpcs(log)[0]!.p_chave_ciclo)).toMatch(/^reavaliar_perdido:/);

    // Já um reavaliar aberto segura o próximo.
    const reavaliar = {
      lead_id: 'lead-9',
      operacao_id: null,
      chave_ciclo: 'reavaliar_perdido:lead-9:2026-10-21T01:00:00.000Z:2026-10-30',
    };
    const outro = sbFake({ perdidos: [perdido], ativos: ['broker-1'], abertas: [reavaliar] });
    expect(await rodar(outro.sb)).toMatchObject({ tarefas: 0 });
    expect(rpcs(outro.log)).toEqual([]);
  });

  it('perdido com publicação nova sem X1: nada, nem aviso', async () => {
    vi.mocked(buscarPorCnj).mockResolvedValue([pub(701, '2026-11-09', ['4'])]);
    const { sb, log } = sbFake({
      perdidos: [
        {
          id: 'lead-9',
          nome: 'Bia Lima',
          numero_processo: CNJ_PERDIDO,
          dono_id: 'broker-1',
          status_desde: '2026-10-21T01:00:00Z',
        },
      ],
      vistos: [{ numero_processo: CNJ_PERDIDO, verificado_em: '2026-11-01T11:00:00Z' }],
      conhecidas: { [CNJ_PERDIDO]: [600] },
      ativos: ['broker-1'],
    });
    const r = await rodar(sb);
    expect(r).toMatchObject({ comNovidade: 1, tarefas: 0, avisos: 0 });
    expect(rpcs(log)).toEqual([]);
  });

  it('processo que só tem lead perdido vai pro fim da fila', async () => {
    const { sb } = sbFake({
      leads: [LEAD_ATIVO],
      perdidos: [
        {
          id: 'lead-9',
          nome: 'Bia Lima',
          numero_processo: CNJ_PERDIDO,
          dono_id: 'broker-1',
          status_desde: '2026-10-21T01:00:00Z',
        },
      ],
      // O ativo foi visto ontem; o perdido nunca. Sem a regra de fila, o
      // nunca visto viria primeiro e tomaria a única vaga.
      ...JA_VISTO,
      ativos: ['broker-1'],
    });
    await rodar(sb, LIGADA, 1);
    expect(vi.mocked(buscarPorCnj).mock.calls.map((c) => c[0])).toEqual([CNJ_ATIVO]);
  });
});
