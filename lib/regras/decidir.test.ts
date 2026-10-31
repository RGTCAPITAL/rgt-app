import { describe, expect, it } from 'vitest';
import {
  chaveFollowUp,
  chaveParado,
  decidirRegrasDeLead,
  decidirTarefaDoProcesso,
  lerConfig,
  linhaDoModelo,
  type AlvoDaRegraProcesso,
  type ConfigRegras,
  type LeadNoCiclo,
  type PublicacaoDaRegra,
} from './decidir';

/**
 * As regras automáticas, sem banco e sem relógio. Os dados são fictícios.
 *
 * 10/11/2026, 9h30 em Maceió (12h30 UTC): o cron de regras roda nessa faixa.
 */
const AGORA = new Date('2026-11-10T12:30:00Z');
const HORA = 3_600_000;
const ha = (horas: number) => new Date(AGORA.getTime() - horas * HORA).toISOString();

const LIGADAS = lerConfig([
  { chave: 'follow_up', ativa: true, parametros: { dias: 2, max_tentativas: 2 } },
  { chave: 'lead_parado', ativa: true, parametros: { dias: 7 } },
  { chave: 'processo_andou', ativa: true, parametros: {} },
]);
const SO_FOLLOW_UP: ConfigRegras = {
  ...LIGADAS,
  leadParado: { ...LIGADAS.leadParado, ativa: false },
};
const SO_PARADO: ConfigRegras = { ...LIGADAS, followUp: { ...LIGADAS.followUp, ativa: false } };

function lead(p: Partial<LeadNoCiclo> = {}): LeadNoCiclo {
  return {
    id: 'lead-1',
    nome: 'José da Silva',
    status: 'em_contato',
    donoId: 'broker-1',
    statusDesde: ha(49),
    temTarefaAberta: false,
    ultimaEntradaWhatsapp: null,
    ultimoModeloEm: null,
    disparos: [],
    ...p,
  };
}

const umaSo = (l: LeadNoCiclo, cfg: ConfigRegras = LIGADAS) => {
  const r = decidirRegrasDeLead([l], cfg, AGORA);
  expect(r.length).toBeLessThanOrEqual(1);
  return r[0] ?? null;
};

describe('configuração', () => {
  it('linha ausente conta como desligada', () => {
    const cfg = lerConfig([]);
    expect(cfg.followUp.ativa).toBe(false);
    expect(cfg.leadParado.ativa).toBe(false);
    expect(cfg.processoAndou.ativa).toBe(false);
  });

  it('parâmetro inválido conta como desligada e é marcado como inválido', () => {
    const cfg = lerConfig([
      { chave: 'follow_up', ativa: true, parametros: { dias: 0, max_tentativas: 2 } },
      { chave: 'lead_parado', ativa: true, parametros: { dias: '7' } },
    ]);
    expect(cfg.followUp).toMatchObject({ ativa: false, valida: false });
    expect(cfg.leadParado).toMatchObject({ ativa: false, valida: false, dias: 7 });
  });

  it('regra desligada nunca gera nada', () => {
    const desligadas = lerConfig([
      { chave: 'follow_up', ativa: false, parametros: { dias: 2, max_tentativas: 2 } },
      { chave: 'lead_parado', ativa: false, parametros: { dias: 7 } },
    ]);
    expect(decidirRegrasDeLead([lead({ statusDesde: ha(24 * 30) })], desligadas, AGORA)).toEqual(
      [],
    );
  });
});

describe('regra (a): follow-up', () => {
  it('há 47h não gera nada; há 49h gera a tentativa 1', () => {
    expect(umaSo(lead({ statusDesde: ha(47) }))).toBeNull();
    const t = umaSo(lead({ statusDesde: ha(49) }))!;
    expect(t.regra).toBe('follow_up');
    expect(t.tentativa).toBe(1);
    expect(t.titulo).toBe('Follow-up 1 de 2: sem resposta há 2 dias');
    expect(t.destinatarioId).toBe('broker-1');
    expect(t.destinatarioPerfil).toBeNull();
    expect(t.descricao).toContain('José da Silva está em Em contato desde 08/11');
    expect(t.descricao).toContain('não há resposta registrada no WhatsApp da RGT');
    expect(t.descricao).toContain('ícone verde no card do lead');
    expect(t.descricao).not.toContain('última tentativa');
    expect(t.motivo).toBe(
      'Em contato há 2 dias, sem resposta no WhatsApp da RGT (tentativa 1 de 2)',
    );
  });

  it('resposta recebida depois de entrar em Em contato: nada', () => {
    expect(umaSo(lead({ ultimaEntradaWhatsapp: ha(10) }))).toBeNull();
  });

  it('mensagem recebida ANTES de entrar em Em contato conta como sem resposta', () => {
    expect(umaSo(lead({ ultimaEntradaWhatsapp: ha(60) }))?.regra).toBe('follow_up');
  });

  it('tarefa pendente ou em andamento: nada', () => {
    expect(umaSo(lead({ temTarefaAberta: true }))).toBeNull();
  });

  it('a 2ª tentativa espera 2 dias depois da 1ª e avisa que é a última', () => {
    const desde = ha(24 * 4);
    const primeira = (horasAtras: number) => ({
      regra: 'follow_up' as const,
      chaveCiclo: chaveFollowUp('lead-1', desde, 1),
      criadoEm: ha(horasAtras),
    });

    expect(umaSo(lead({ statusDesde: desde, disparos: [primeira(24)] }), SO_FOLLOW_UP)).toBeNull();

    const t = umaSo(lead({ statusDesde: desde, disparos: [primeira(48)] }), SO_FOLLOW_UP)!;
    expect(t.tentativa).toBe(2);
    expect(t.titulo).toBe('Último follow-up (2 de 2): sem resposta há 4 dias');
    expect(t.descricao).toContain('Esta é a última tentativa automática');
    expect(t.chaveCiclo).toBe(chaveFollowUp('lead-1', desde, 2));
  });

  it('com as 2 tentativas feitas no ciclo, o follow-up para', () => {
    const desde = ha(24 * 6);
    const disparos = [1, 2].map((k) => ({
      regra: 'follow_up' as const,
      chaveCiclo: chaveFollowUp('lead-1', desde, k),
      criadoEm: ha(24 * (6 - 2 * k)),
    }));
    expect(umaSo(lead({ statusDesde: desde, disparos }), SO_FOLLOW_UP)).toBeNull();
    // Com o parado ligado também nada: 6 dias ainda não é "parado" (7).
    expect(umaSo(lead({ statusDesde: desde, disparos }))).toBeNull();
  });

  it('follow-up de outro ciclo (outra entrada na etapa) não conta', () => {
    const antigo = ha(24 * 20);
    const disparos = [1, 2].map((k) => ({
      regra: 'follow_up' as const,
      chaveCiclo: chaveFollowUp('lead-1', antigo, k),
      criadoEm: ha(24 * 15),
    }));
    expect(umaSo(lead({ disparos }))?.tentativa).toBe(1);
  });

  it('sem dono, ou com dono inativo (donoId null), vai pra gestão', () => {
    const t = umaSo(lead({ donoId: null }))!;
    expect(t.destinatarioId).toBeNull();
    expect(t.destinatarioPerfil).toBe('gestao');
  });

  it('só vale pra Em contato', () => {
    expect(umaSo(lead({ status: 'qualificado' }), SO_FOLLOW_UP)).toBeNull();
  });
});

describe('regra (a): o que a tarefa diz sobre o modelo da RGT', () => {
  it('modelo há 3 dias: ainda não dá, com a data de liberação', () => {
    expect(linhaDoModelo(ha(24 * 3), AGORA)).toBe(
      'Pelo número da RGT ainda não dá: o modelo saiu em 07/11 e só pode ser reenviado a partir de 14/11.',
    );
  });

  it('modelo há 8 dias: já pode reenviar', () => {
    expect(linhaDoModelo(ha(24 * 8), AGORA)).toContain('o modelo já pode ser reenviado');
  });

  it('nenhum modelo: aponta o botão do card', () => {
    expect(linhaDoModelo(null, AGORA)).toContain('Você também pode mandar o modelo');
    expect(linhaDoModelo(null, AGORA)).toContain('no card');
  });

  it('a linha entra na descrição da tarefa', () => {
    const t = umaSo(lead({ ultimoModeloEm: ha(50) }))!;
    expect(t.descricao).toContain('ainda não dá');
  });
});

describe('regra (b): lead parado', () => {
  it('6d23h não gera nada; 7d gera, com a dica da etapa', () => {
    expect(umaSo(lead({ status: 'qualificado', statusDesde: ha(24 * 7 - 1) }))).toBeNull();
    const t = umaSo(lead({ status: 'qualificado', statusDesde: ha(24 * 7) }))!;
    expect(t.regra).toBe('lead_parado');
    expect(t.titulo).toBe('Lead parado há 7 dias em Qualificado');
    expect(t.descricao).toContain('Monte a proposta e envie.');
    expect(t.descricao).toContain('Este aviso sai uma vez por etapa.');
    expect(t.motivo).toBe('Parado há 7 dias em Qualificado');
  });

  it('mesma entrada na etapa já avisada: nada; entrada nova: avisa de novo', () => {
    const desde = ha(24 * 10);
    const disparos = [
      {
        regra: 'lead_parado' as const,
        chaveCiclo: chaveParado('lead-1', 'qualificado', desde),
        criadoEm: ha(24 * 3),
      },
    ];
    expect(umaSo(lead({ status: 'qualificado', statusDesde: desde, disparos }))).toBeNull();
    expect(umaSo(lead({ status: 'qualificado', statusDesde: ha(24 * 8), disparos }))?.regra).toBe(
      'lead_parado',
    );
  });

  it('ganho e perdido nunca', () => {
    for (const status of ['ganho', 'perdido']) {
      expect(umaSo(lead({ status, statusDesde: ha(24 * 60) }))).toBeNull();
    }
  });

  it('com tarefa aberta: nada', () => {
    expect(
      umaSo(lead({ status: 'proposta_enviada', statusDesde: ha(24 * 9), temTarefaAberta: true })),
    ).toBeNull();
  });

  it('follow-up e parado elegíveis no mesmo dia: sai só o follow-up', () => {
    const r = decidirRegrasDeLead([lead({ statusDesde: ha(24 * 8) })], LIGADAS, AGORA);
    expect(r.map((t) => t.regra)).toEqual(['follow_up']);
  });

  it('com o follow-up desligado, o Em contato parado recebe o aviso de parado', () => {
    const t = umaSo(lead({ statusDesde: ha(24 * 8) }), SO_PARADO)!;
    expect(t.titulo).toBe('Lead parado há 8 dias em Em contato');
  });

  it('lead novo sem dono recebe a dica de definir quem cuida', () => {
    const t = umaSo(lead({ status: 'novo', donoId: null, statusDesde: ha(24 * 7) }))!;
    expect(t.destinatarioPerfil).toBe('gestao');
    expect(t.descricao).toContain('Defina quem cuida dele');
  });
});

describe('prazo e chave', () => {
  it('prazo é o dia de São Paulo (23h30 em Maceió continua sendo hoje)', () => {
    const noite = new Date('2026-11-11T02:30:00Z'); // 10/11, 23h30 em Maceió
    const l = lead({ statusDesde: new Date(noite.getTime() - 50 * HORA).toISOString() });
    expect(decidirRegrasDeLead([l], LIGADAS, noite)[0]!.prazo).toBe('2026-11-10');
  });

  it('a mesma entrada dá a mesma chave, com ou sem microssegundos', () => {
    expect(chaveFollowUp('l', '2026-10-30T14:03:22.123456+00:00', 1)).toBe(
      chaveFollowUp('l', '2026-10-30T14:03:22.123Z', 1),
    );
    expect(chaveParado('l', 'novo', '2026-10-30T14:03:22.123456+00:00')).toBe(
      'lead_parado:l:novo:2026-10-30T14:03:22.123Z',
    );
  });

  it('o disparo anterior com microssegundos é reconhecido como do mesmo ciclo', () => {
    const desdeBanco = '2026-11-04T12:30:00.000123+00:00';
    const disparos = [
      {
        regra: 'follow_up' as const,
        chaveCiclo: chaveFollowUp('lead-1', desdeBanco, 1),
        criadoEm: ha(72),
      },
    ];
    expect(umaSo(lead({ statusDesde: desdeBanco, disparos }), SO_FOLLOW_UP)?.tentativa).toBe(2);
  });
});

describe('regra (c): processo andou', () => {
  const HOJE = '2026-11-10';
  const pub = (id: number, data: string, codigos: string[] = []): PublicacaoDaRegra => ({
    id,
    dataDisponibilizacao: data,
    redFlags: codigos.map((codigo) => ({ codigo }) as PublicacaoDaRegra['redFlags'][number]),
  });
  const ativo: AlvoDaRegraProcesso = {
    tipo: 'lead',
    id: 'lead-1',
    nome: 'José da Silva',
    cnj: '00011073320175190001',
    destinatarioId: 'broker-1',
  };
  const resumo = {
    descricao: '1 publicação nova no Diário (09/11/2026). Despacho',
    urgente: false,
  };
  const ctx = (p: Partial<Parameters<typeof decidirTarefaDoProcesso>[1]> = {}) => ({
    novas: [pub(501, '2026-11-09')],
    todas: [pub(501, '2026-11-09'), pub(400, '2026-09-01')],
    jaVisto: true,
    temTarefaAbertaDaRegra: false,
    ...p,
  });

  it('alvo ativo com publicação nova gera a tarefa de ler', () => {
    const t = decidirTarefaDoProcesso(ativo, ctx(), resumo, HOJE)!;
    expect(t.titulo).toBe('Ler publicação nova no Diário');
    expect(t.chaveCiclo).toBe('processo_andou:lead:lead-1:501');
    expect(t.descricao.startsWith(resumo.descricao)).toBe(true);
    expect(t.descricao).toContain('anote no lead');
    expect(t.motivo).toBe('Publicação nova no Diário (09/11/2026)');
    expect(t).toMatchObject({ leadId: 'lead-1', operacaoId: null, prazo: HOJE });
  });

  it('resumo urgente: o título começa com URGENTE', () => {
    const t = decidirTarefaDoProcesso(ativo, ctx(), { ...resumo, urgente: true }, HOJE)!;
    expect(t.titulo).toBe('URGENTE: ler publicação grave no Diário');
  });

  it('linha de base (processo nunca visto) em alvo ativo: nada', () => {
    expect(decidirTarefaDoProcesso(ativo, ctx({ jaVisto: false }), resumo, HOJE)).toBeNull();
  });

  it('já tem tarefa aberta da regra pra esse alvo: não empilha outra', () => {
    expect(
      decidirTarefaDoProcesso(ativo, ctx({ temTarefaAbertaDaRegra: true }), resumo, HOJE),
    ).toBeNull();
  });

  it('operação sem responsável ativo vai pra gestão', () => {
    const t = decidirTarefaDoProcesso(
      { ...ativo, tipo: 'operacao', id: 'op-1', destinatarioId: null },
      ctx(),
      resumo,
      HOJE,
    )!;
    expect(t).toMatchObject({ leadId: null, operacaoId: 'op-1', destinatarioPerfil: 'gestao' });
    expect(t.descricao).toContain('anote na operação');
  });

  describe('lead perdido sem ofício', () => {
    // Perdido em 20/10, 22h em Maceió (já 21/10 em UTC): o corte é 20/10.
    const perdido = { ...ativo, perdidoDesde: '2026-10-21T01:00:00Z' };

    it('ofício (X1) depois da perda gera "reavaliar", inclusive na linha de base', () => {
      const todas = [pub(700, '2026-11-05', ['X1', 'X7']), pub(300, '2026-08-01')];
      const t = decidirTarefaDoProcesso(
        perdido,
        ctx({ jaVisto: false, novas: todas, todas }),
        resumo,
        HOJE,
      )!;
      expect(t.titulo).toBe('Reavaliar lead perdido: saiu o ofício');
      expect(t.chaveCiclo).toBe('reavaliar_perdido:lead-1:2026-10-21T01:00:00.000Z');
      expect(t.descricao).toContain('O Diário de 05/11/2026 mostra ofício expedido');
      expect(t.descricao).toContain('0001107-33.2017.5.19.0001');
      expect(t.descricao).toContain('O lead continua em Perdido');
      expect(t.motivo).toBe('Perdido sem ofício; ofício expedido no Diário de 05/11/2026');
    });

    it('X1 no próprio dia da perda (em São Paulo) conta', () => {
      const todas = [pub(700, '2026-10-20', ['X1'])];
      expect(decidirTarefaDoProcesso(perdido, ctx({ todas }), resumo, HOJE)?.titulo).toContain(
        'Reavaliar',
      );
    });

    it('X1 datado antes da perda: nada', () => {
      const todas = [pub(700, '2026-10-19', ['X1'])];
      expect(decidirTarefaDoProcesso(perdido, ctx({ todas }), resumo, HOJE)).toBeNull();
    });

    it('publicação nova sem X1: nada, nem a tarefa de ler', () => {
      const todas = [pub(700, '2026-11-05', ['4'])];
      expect(
        decidirTarefaDoProcesso(perdido, ctx({ novas: todas, todas }), resumo, HOJE),
      ).toBeNull();
    });
  });
});
