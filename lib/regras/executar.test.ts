import { describe, expect, it } from 'vitest';
import { lerConfig, TUDO_DESLIGADO, type ConfigRegras } from './decidir';
import { rodarRegrasDeLead } from './executar';

/**
 * A rodada das regras (a) e (b) com um Supabase falso: confere que as
 * consultas viram as decisões certas e que "já feito" não conta como falha.
 * Nenhum teste toca banco. Dados fictícios.
 */

const AGORA = new Date('2026-11-10T12:30:00Z');
const ha = (horas: number) => new Date(AGORA.getTime() - horas * 3_600_000).toISOString();

const LIGADAS = lerConfig([
  { chave: 'follow_up', ativa: true, parametros: { dias: 2, max_tentativas: 2 } },
  { chave: 'lead_parado', ativa: true, parametros: { dias: 7 } },
  { chave: 'processo_andou', ativa: false, parametros: {} },
]);
const SO_FOLLOW_UP: ConfigRegras = {
  ...LIGADAS,
  leadParado: { ...LIGADAS.leadParado, ativa: false },
};

type Tabelas = Partial<Record<string, Record<string, unknown>[]>>;

/** Cada from() devolve as linhas da tabela; filtros ficam registrados pra conferir. */
function sbFake(
  tabelas: Tabelas,
  rpc: (args: Record<string, unknown>) => {
    data: unknown;
    error: { message: string } | null;
  } = () => ({
    data: 'tarefa-nova',
    error: null,
  }),
) {
  const consultas: { tabela: string; filtros: unknown[][] }[] = [];
  const rpcs: Record<string, unknown>[] = [];
  const from = (tabela: string) => {
    const filtros: unknown[][] = [];
    consultas.push({ tabela, filtros });
    const b: Record<string, unknown> = {};
    const encadear =
      (op: string) =>
      (...args: unknown[]) => {
        filtros.push([op, ...args]);
        return b;
      };
    for (const op of ['select', 'eq', 'in', 'not', 'or', 'gte', 'order', 'range'])
      b[op] = encadear(op);
    // range(de, ate) corta as linhas como o PostgREST, pra exercitar a paginação.
    b.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => {
      const linhas = tabelas[tabela] ?? [];
      const range = filtros.find((f) => f[0] === 'range') as [string, number, number] | undefined;
      const data = range ? linhas.slice(range[1], range[2] + 1) : linhas;
      return Promise.resolve({ data, error: null }).then(ok, erro);
    };
    return b;
  };
  const client = {
    from,
    rpc: (_nome: string, args: Record<string, unknown>) => {
      rpcs.push(args);
      return Promise.resolve(rpc(args));
    },
  };
  // O tipo real é SupabaseClient; aqui só from()/rpc() são exercidos.
  return { sb: client as never, consultas, rpcs };
}

const BASE: Tabelas = {
  leads: [
    // Em contato há 50h, o modelo saiu há 51h e ninguém respondeu.
    {
      id: 'l1',
      nome: 'Ana Souza',
      status: 'em_contato',
      dono_id: 'b1',
      status_desde: ha(50),
      dono: { ativo: true },
    },
    // Respondeu pelo WhatsApp da RGT depois de entrar em Em contato.
    {
      id: 'l2',
      nome: 'Bia Lima',
      status: 'em_contato',
      dono_id: 'b2',
      status_desde: ha(50),
      dono: { ativo: true },
    },
    // Parado há 8 dias, mas já tem tarefa aberta.
    {
      id: 'l3',
      nome: 'Caio Melo',
      status: 'qualificado',
      dono_id: 'b1',
      status_desde: ha(24 * 8),
      dono: { ativo: true },
    },
  ],
  tarefas: [{ lead_id: 'l3' }],
  whatsapp_conversas: [
    { id: 'c1', lead_id: 'l1' },
    { id: 'c2', lead_id: 'l2' },
  ],
  whatsapp_mensagens: [
    {
      conversa_id: 'c1',
      direcao: 'saida',
      template_nome: 'rgt_proposta_credor',
      created_at: ha(51),
    },
    { conversa_id: 'c2', direcao: 'entrada', template_nome: null, created_at: ha(10) },
  ],
  regras_disparos: [],
};

describe('rodarRegrasDeLead', () => {
  it('cria só a tarefa de quem não respondeu e não tem tarefa aberta', async () => {
    const { sb, rpcs } = sbFake(BASE);
    const r = await rodarRegrasDeLead(sb, { agora: AGORA, config: LIGADAS });

    expect(r).toEqual({
      regrasLigadas: ['follow_up', 'lead_parado'],
      leadsAnalisados: 3,
      tarefasCriadas: 1,
      jaExistiam: 0,
      falhas: 0,
    });
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]).toMatchObject({
      p_regra: 'follow_up',
      p_lead_id: 'l1',
      p_operacao_id: null,
      p_destinatario_id: 'b1',
      p_destinatario_perfil: null,
      p_tentativa: 1,
      p_prazo: '2026-11-10',
      p_titulo: 'Follow-up 1 de 2: sem resposta há 2 dias',
    });
    // O modelo enviado há 51h não conta como resposta, e a tarefa nunca manda
    // reenviar a mensagem fria pelo número da RGT.
    expect(rpcs[0]!.p_descricao).not.toMatch(/modelo|reenviad/i);
  });

  it('dono inativo: a tarefa vai pra gestão', async () => {
    const { sb, rpcs } = sbFake({
      ...BASE,
      leads: [{ ...BASE.leads![0]!, dono: { ativo: false } }],
    });
    await rodarRegrasDeLead(sb, { agora: AGORA, config: LIGADAS });
    expect(rpcs[0]).toMatchObject({ p_destinatario_id: null, p_destinatario_perfil: 'gestao' });
  });

  it('RPC devolvendo null (já feito) conta como "já existia", não como falha', async () => {
    const { sb } = sbFake(BASE, () => ({ data: null, error: null }));
    const r = await rodarRegrasDeLead(sb, { agora: AGORA, config: LIGADAS });
    expect(r).toMatchObject({ tarefasCriadas: 0, jaExistiam: 1, falhas: 0 });
  });

  it('erro numa tarefa não para as outras', async () => {
    const leads = [
      BASE.leads![0]!,
      { ...BASE.leads![0]!, id: 'l4', nome: 'Davi Reis', dono_id: 'b2' },
    ];
    const { sb, rpcs } = sbFake({ ...BASE, leads }, (args) =>
      args.p_lead_id === 'l1'
        ? { data: null, error: { message: 'deadlock' } }
        : { data: 'tarefa-nova', error: null },
    );
    const r = await rodarRegrasDeLead(sb, { agora: AGORA, config: LIGADAS });
    expect(rpcs).toHaveLength(2);
    expect(r).toMatchObject({ tarefasCriadas: 1, falhas: 1 });
  });

  it('tudo desligado: nem consulta o banco', async () => {
    const { sb, consultas } = sbFake(BASE);
    const r = await rodarRegrasDeLead(sb, { agora: AGORA, config: TUDO_DESLIGADO });
    expect(r.regrasLigadas).toEqual([]);
    expect(consultas).toEqual([]);
  });

  it('só o follow-up ligado: só busca leads em Em contato, sem os de exemplo', async () => {
    const { sb, consultas } = sbFake(BASE);
    await rodarRegrasDeLead(sb, { agora: AGORA, config: SO_FOLLOW_UP });
    const leads = consultas.find((c) => c.tabela === 'leads')!;
    expect(leads.filtros).toContainEqual(['in', 'status', ['em_contato']]);
    expect(leads.filtros).toContainEqual(['eq', 'is_exemplo', false]);
  });

  it('lead parado ligado: busca as 4 etapas e a origem (importação é descartada na decisão)', async () => {
    const { sb, consultas } = sbFake(BASE);
    await rodarRegrasDeLead(sb, { agora: AGORA, config: LIGADAS });
    const leads = consultas.find((c) => c.tabela === 'leads')!;
    expect(leads.filtros).toContainEqual([
      'in',
      'status',
      ['novo', 'em_contato', 'qualificado', 'proposta_enviada'],
    ]);
    expect(String(leads.filtros.find((f) => f[0] === 'select')?.[1])).toContain('origem');
  });

  it('só o lead parado ligado: nem olha o WhatsApp', async () => {
    const { sb, consultas } = sbFake(BASE);
    await rodarRegrasDeLead(sb, {
      agora: AGORA,
      config: { ...LIGADAS, followUp: { ...LIGADAS.followUp, ativa: false } },
    });
    const tabelas = consultas.map((c) => c.tabela);
    expect(tabelas).not.toContain('whatsapp_conversas');
    expect(tabelas).not.toContain('whatsapp_mensagens');
  });

  it('resposta depois da linha 1000 ainda conta: pagina as mensagens até o fim', async () => {
    // 1000 modelos de outra conversa enchem a primeira página; a resposta da
    // Ana só aparece na segunda. Sem paginar, ela ganharia follow-up.
    const modelos = Array.from({ length: 1000 }, () => ({
      conversa_id: 'c2',
      direcao: 'saida',
      template_nome: 'rgt_proposta_credor',
      created_at: ha(20),
    }));
    const { sb, rpcs, consultas } = sbFake({
      ...BASE,
      whatsapp_mensagens: [
        ...modelos,
        { conversa_id: 'c1', direcao: 'entrada', template_nome: null, created_at: ha(5) },
      ],
    });
    await rodarRegrasDeLead(sb, { agora: AGORA, config: SO_FOLLOW_UP });
    const msgs = consultas.filter((c) => c.tabela === 'whatsapp_mensagens');
    expect(msgs).toHaveLength(2);
    // Só as recebidas: enviada nunca conta como resposta.
    expect(msgs[0]!.filtros).toContainEqual(['eq', 'direcao', 'entrada']);
    // A Ana respondeu (página 2) e fica de fora. A Bia, que aqui só recebeu
    // modelos, é quem ganha a tarefa.
    expect(rpcs.map((a) => a.p_lead_id)).toEqual(['l2']);
  });

  it('o follow-up anterior do mesmo ciclo vira a tentativa 2', async () => {
    const desde = ha(24 * 4);
    const { sb, rpcs } = sbFake({
      ...BASE,
      leads: [{ ...BASE.leads![0]!, status_desde: desde }],
      regras_disparos: [
        {
          regra: 'follow_up',
          lead_id: 'l1',
          chave_ciclo: `follow_up:l1:${new Date(desde).toISOString()}:1`,
          created_at: ha(48),
        },
      ],
    });
    await rodarRegrasDeLead(sb, { agora: AGORA, config: LIGADAS });
    expect(rpcs[0]).toMatchObject({ p_tentativa: 2 });
    expect(rpcs[0]!.p_titulo).toBe('Último follow-up (2 de 2): sem resposta há 4 dias');
  });
});
