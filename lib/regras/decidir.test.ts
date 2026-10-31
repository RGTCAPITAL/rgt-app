import { describe, expect, it } from 'vitest';
import {
  chaveFollowUp,
  chaveParado,
  decidirRegrasDeLead,
  decidirTarefaDoProcesso,
  lerConfig,
  MAX_PARADOS_POR_PESSOA_DIA,
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
    origem: 'site',
    importado: false,
    statusDesde: ha(49),
    temTarefaAberta: false,
    ultimaEntradaWhatsapp: null,
    ultimaAcaoHumana: null,
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
    expect(t.descricao).toContain(
      'José da Silva está na etapa Em contato e, desde 08/11, não chegou resposta no WhatsApp da RGT',
    );
    expect(t.descricao).toContain('balão do WhatsApp no card (não pelo aviãozinho');
    expect(t.descricao).not.toContain('última tentativa');
    // O follow-up é de gente: nunca manda reenviar a mensagem fria pelo número da RGT.
    expect(t.descricao).not.toMatch(/modelo|reenviad/i);
    // Respondeu por outro canal: mexer no card é o que para os lembretes
    // (só anotar fazia a 2ª tentativa dizer "sem resposta").
    expect(t.descricao).toContain('mova o card para Qualificado');
    expect(t.descricao).toContain('agende um retorno');
    expect(t.descricao).toContain('encerra os follow-ups deste lead');
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
    // O disparo anterior é gravado segundos depois do início da rodada: a
    // rodada de 2 dias depois não pode escorregar pro dia seguinte.
    const quaseDoisDias = {
      ...primeira(0),
      criadoEm: new Date(AGORA.getTime() - 48 * HORA + 5_000).toISOString(),
    };
    expect(
      umaSo(lead({ statusDesde: desde, disparos: [quaseDoisDias] }), SO_FOLLOW_UP)?.tentativa,
    ).toBe(2);

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

describe('regra (b): lead parado', () => {
  it('6d23h não gera nada; 7d gera, com a dica da etapa', () => {
    expect(umaSo(lead({ status: 'qualificado', statusDesde: ha(24 * 7 - 1) }))).toBeNull();
    const t = umaSo(lead({ status: 'qualificado', statusDesde: ha(24 * 7) }))!;
    expect(t.regra).toBe('lead_parado');
    expect(t.titulo).toBe('Lead parado há 7 dias na etapa Qualificado');
    expect(t.descricao).toContain('há pelo menos 7 dias');
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
    expect(t.titulo).toBe('Lead parado há 8 dias na etapa Em contato');
  });

  it('Em contato com o follow-up ainda cuidando (sem resposta, tentativas sobrando): sem parado', () => {
    const desde = ha(24 * 8);
    const uma = [
      {
        regra: 'follow_up' as const,
        chaveCiclo: chaveFollowUp('lead-1', desde, 1),
        criadoEm: ha(24),
      },
    ];
    // A 2ª tentativa ainda vai sair: o parado não fala junto.
    expect(umaSo(lead({ statusDesde: desde, disparos: uma }))).toBeNull();
  });

  it('Em contato depois das tentativas esgotadas: o parado espera 7 dias desde o último follow-up', () => {
    const desde = ha(24 * 12);
    const fu = (diasAtras: number, k: number) => ({
      regra: 'follow_up' as const,
      chaveCiclo: chaveFollowUp('lead-1', desde, k),
      criadoEm: ha(24 * diasAtras),
    });
    // Último follow-up há 2 dias: nada ainda (sem a sequência dia 2, dia 4, dia 7).
    expect(umaSo(lead({ statusDesde: desde, disparos: [fu(4, 1), fu(2, 2)] }))).toBeNull();
    // Há 8 dias: volta o parado.
    expect(umaSo(lead({ statusDesde: desde, disparos: [fu(10, 1), fu(8, 2)] }))?.regra).toBe(
      'lead_parado',
    );
  });

  it('retorno agendado (registro de uma pessoa) encerra o follow-up', () => {
    // Atendeu a ligação; o broker agendou um retorno ontem e o concluiu.
    expect(umaSo(lead({ statusDesde: ha(24 * 3), ultimaAcaoHumana: ha(24) }))).toBeNull();
  });

  it('depois do retorno, o parado conta 7 dias a partir dele, com a dica de quem já respondeu', () => {
    const desde = ha(24 * 15);
    expect(umaSo(lead({ statusDesde: desde, ultimaAcaoHumana: ha(24 * 3) }))).toBeNull();
    const t = umaSo(lead({ statusDesde: desde, ultimaAcaoHumana: ha(24 * 8) }))!;
    expect(t.regra).toBe('lead_parado');
    expect(t.descricao).toContain('A pessoa já deu retorno');
    expect(t.descricao).not.toContain('Tente outro canal');
  });

  it('Em contato que RESPONDEU e travou: volta o parado (o lead mais quente não pode sumir)', () => {
    const t = umaSo(lead({ statusDesde: ha(24 * 8), ultimaEntradaWhatsapp: ha(24 * 7) }))!;
    expect(t.regra).toBe('lead_parado');
    expect(t.titulo).toBe('Lead parado há 8 dias na etapa Em contato');
    expect(t.descricao).toContain('A pessoa já deu retorno');
  });

  it('Novo de importação em massa: nunca (sem enxurrada)', () => {
    for (const origem of ['importacao_planilha', 'lista_processual']) {
      expect(umaSo(lead({ status: 'novo', origem, statusDesde: ha(24 * 30) }))).toBeNull();
    }
    // Importado com outra origem escolhida no formulário (ex.: Indicação).
    expect(
      umaSo(
        lead({ status: 'novo', origem: 'indicacao', importado: true, statusDesde: ha(24 * 30) }),
      ),
    ).toBeNull();
  });

  it('Novo que o broker abordou (LinkedIn, evento): sem "foi a pessoa que procurou"', () => {
    const t = umaSo(lead({ status: 'novo', origem: 'linkedin', statusDesde: ha(24 * 7) }))!;
    expect(t.descricao).toContain('Defina quem cuida dele e faça o primeiro contato.');
    expect(t.descricao).not.toContain('procurou a RGT');
  });

  it('Novo que chegou sozinho (site, WhatsApp) e ninguém pegou: avisa a gestão', () => {
    const t = umaSo(
      lead({ status: 'novo', origem: 'whatsapp', donoId: null, statusDesde: ha(24 * 7) }),
    )!;
    expect(t.regra).toBe('lead_parado');
    expect(t.destinatarioPerfil).toBe('gestao');
    expect(t.descricao).toContain('foi a pessoa que procurou a RGT');
  });

  it('o texto não afirma a data de entrada na etapa (lead anterior à 048 conta da migration)', () => {
    const t = umaSo(lead({ status: 'qualificado', statusDesde: ha(24 * 9) }))!;
    expect(t.descricao).toContain('não avança da etapa Qualificado há pelo menos 9 dias');
  });

  it(`no máximo ${MAX_PARADOS_POR_PESSOA_DIA} por pessoa por rodada, os mais antigos primeiro`, () => {
    const muitos = Array.from({ length: 15 }, (_, i) =>
      lead({ id: `l-${i}`, status: 'qualificado', statusDesde: ha(24 * (8 + i)) }),
    );
    const outroDono = lead({
      id: 'outro',
      donoId: 'broker-2',
      status: 'qualificado',
      statusDesde: ha(24 * 8),
    });
    const r = decidirRegrasDeLead([...muitos, outroDono], SO_PARADO, AGORA);
    const doBroker1 = r.filter((t) => t.destinatarioId === 'broker-1');
    expect(doBroker1).toHaveLength(MAX_PARADOS_POR_PESSOA_DIA);
    // Ficam os 10 parados há mais tempo (l-14 … l-5); os outros voltam amanhã.
    expect(doBroker1.map((t) => t.leadId)).toContain('l-14');
    expect(doBroker1.map((t) => t.leadId)).not.toContain('l-0');
    // O teto é por pessoa: o broker-2 não perde a vez.
    expect(r.some((t) => t.leadId === 'outro')).toBe(true);
  });

  it('o teto não corta follow-up', () => {
    const r = decidirRegrasDeLead(
      Array.from({ length: 12 }, (_, i) => lead({ id: `f-${i}` })),
      LIGADAS,
      AGORA,
    );
    expect(r).toHaveLength(12);
    expect(r.every((t) => t.regra === 'follow_up')).toBe(true);
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
    link: `https://comunica.pje.jus.br/consulta/${id}`,
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
    expect(t.descricao.startsWith('Processo 0001107-33.2017.5.19.0001.')).toBe(true);
    expect(t.descricao).toContain(resumo.descricao);
    expect(t.descricao).toContain(
      'Publicação de 09/11/2026: https://comunica.pje.jus.br/consulta/501',
    );
    expect(t.descricao).toContain('anote no lead');
    expect(t.motivo).toBe('Publicação nova no Diário (09/11/2026)');
    expect(t).toMatchObject({ leadId: 'lead-1', operacaoId: null, prazo: HOJE });
  });

  it('publicação "nova" só pelo id, mas antiga pela data: nada', () => {
    // O DJEN devolveu uma de 12/11/2025 que ainda não estava salva.
    const antiga = [pub(900, '2025-11-12')];
    expect(
      decidirTarefaDoProcesso(ativo, ctx({ novas: antiga, corteData: '2026-11-06' }), resumo, HOJE),
    ).toBeNull();
  });

  it('com o corte, a chave e o motivo usam só as que passaram', () => {
    const novas = [pub(900, '2025-11-12'), pub(501, '2026-11-09')];
    const t = decidirTarefaDoProcesso(
      ativo,
      ctx({ novas, corteData: '2026-11-06' }),
      resumo,
      HOJE,
    )!;
    expect(t.chaveCiclo).toBe('processo_andou:lead:lead-1:501');
    expect(t.descricao).not.toContain('/900');
  });

  it('tarefa que nasce no fim de semana vence na segunda', () => {
    const sabado = decidirTarefaDoProcesso(ativo, ctx(), resumo, '2026-11-14')!;
    expect(sabado.prazo).toBe('2026-11-16');
    const domingo = decidirTarefaDoProcesso(ativo, ctx(), resumo, '2026-11-15')!;
    expect(domingo.prazo).toBe('2026-11-16');
  });

  it('link repetido do DJEN aparece uma vez só', () => {
    const repetidas = [
      pub(501, '2026-11-09'),
      { ...pub(502, '2026-11-09'), link: pub(501, '').link },
    ];
    const t = decidirTarefaDoProcesso(ativo, ctx({ novas: repetidas }), resumo, HOJE)!;
    expect(t.descricao.match(/consulta\/501/g)).toHaveLength(1);
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
      expect(t.titulo).toBe('Reavaliar lead perdido: o Diário cita ofício requisitório');
      expect(t.chaveCiclo).toBe('reavaliar_perdido:lead-1:2026-10-21T01:00:00.000Z:2026-11-05');
      expect(t.descricao).toContain('marque como perdido de novo, sem a opção do ofício');
      expect(t.descricao).toContain(
        'o sistema avisa de novo quando o Diário citar o ofício outra vez',
      );
      expect(t.descricao).toContain('O Diário de 05/11/2026 cita ofício requisitório');
      expect(t.descricao).toContain('Confira no PJe');
      // Citar não é expedir: o texto não afirma que saiu.
      expect(t.descricao).not.toMatch(/ofício expedido|saiu o ofício/);
      expect(t.descricao).toContain('0001107-33.2017.5.19.0001');
      expect(t.descricao).toContain('Publicação de 05/11/2026: https://');
      expect(t.descricao).toContain('O lead continua em Perdido');
      expect(t.motivo).toBe('Perdido sem ofício; o Diário de 05/11/2026 cita ofício requisitório');
    });

    it('nova citação em outro dia gera outra tarefa; cópia do mesmo dia (outro id) não', () => {
      const primeira = [pub(700, '2026-11-05', ['X1'])];
      const copia = [pub(950, '2026-11-05', ['X1']), ...primeira];
      const depois = [pub(812, '2026-12-03', ['X1']), ...primeira];
      const a = decidirTarefaDoProcesso(perdido, ctx({ todas: primeira }), resumo, HOJE)!;
      const c = decidirTarefaDoProcesso(perdido, ctx({ todas: copia }), resumo, HOJE)!;
      const b = decidirTarefaDoProcesso(perdido, ctx({ todas: depois }), resumo, HOJE)!;
      expect(c.chaveCiclo).toBe(a.chaveCiclo);
      expect(b.chaveCiclo).not.toBe(a.chaveCiclo);
      expect(b.chaveCiclo.endsWith(':2026-12-03')).toBe(true);
    });

    it('com a tarefa de reavaliar ainda aberta: não empilha outra', () => {
      const todas = [pub(700, '2026-11-05', ['X1'])];
      expect(
        decidirTarefaDoProcesso(
          perdido,
          ctx({ todas, temTarefaAbertaDaRegra: true }),
          resumo,
          HOJE,
        ),
      ).toBeNull();
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
