import { describe, expect, it } from 'vitest';
import {
  artigoDoEnte,
  enteComArtigo,
  escolherModelo,
  formatarEnte,
  linkWhatsAppComTexto,
  montarMensagem,
  primeiroNome,
  type DadosLead,
  type ModeloMensagem,
} from './mensagem';

const LEAD_COMPLETO: DadosLead = {
  nome: 'José Ribamar da Silva',
  valorProposta: 120000,
  valorProcesso: 187430,
  numeroProcesso: '0001107-33.2017.5.19.0001',
  enteDevedor: 'Estado de Alagoas',
};

const MODELOS: ModeloMensagem[] = [
  {
    id: 'completo',
    nome: 'Com valor e ente',
    texto: 'Olá {nome}, aqui é da RGT sobre seu precatório de {valor} contra {ente}.',
    requerValor: true,
    requerEnte: true,
    uso: 'primeiro_contato',
  },
  {
    id: 'com-valor',
    nome: 'Só com valor',
    texto: 'Olá {nome}, aqui é da RGT sobre seu precatório de {valor}.',
    requerValor: true,
    requerEnte: false,
    uso: 'primeiro_contato',
  },
  {
    id: 'simples',
    nome: 'Sem valor',
    texto: 'Olá {nome}, aqui é da RGT Capital.',
    requerValor: false,
    requerEnte: false,
    uso: 'primeiro_contato',
  },
  {
    id: 'retomada',
    nome: 'Retomada de contato',
    texto: 'Olá {nome}, aqui é da RGT de novo.',
    requerValor: false,
    requerEnte: false,
    uso: 'retomada',
  },
];

describe('primeiroNome', () => {
  it('usa só o primeiro nome pra mensagem não soar formulário', () => {
    expect(primeiroNome('José Ribamar da Silva')).toBe('José');
    expect(primeiroNome('Maria da Conceição Santos')).toBe('Maria');
  });

  it('mantém o nome inteiro quando o primeiro é inicial', () => {
    // "J. Silva" viraria "Olá J." — pior que o nome completo
    expect(primeiroNome('J. Silva')).toBe('J. Silva');
    expect(primeiroNome('A B Costa')).toBe('A B Costa');
  });

  it('não quebra com espaços sobrando ou nome vazio', () => {
    expect(primeiroNome('  Carlos   Eduardo  ')).toBe('Carlos');
    expect(primeiroNome('')).toBe('');
  });
});

describe('montarMensagem', () => {
  it('substitui as variáveis pelos dados do lead', () => {
    const r = montarMensagem(
      'Olá {nome}, sobre seu precatório de {valor} contra {ente}.',
      LEAD_COMPLETO,
    );
    expect(r).toBe('Olá José, sobre seu precatório de R$ 120.000,00 contra Estado de Alagoas.');
  });

  it('prefere o valor da proposta ao do processo', () => {
    // A proposta é o número que interessa ao credor, não o valor de face.
    const r = montarMensagem('{valor}', LEAD_COMPLETO);
    expect(r).toBe('R$ 120.000,00');
  });

  it('cai pro valor do processo quando não há proposta', () => {
    const r = montarMensagem('{valor}', { ...LEAD_COMPLETO, valorProposta: null });
    expect(r).toBe('R$ 187.430,00');
  });

  it('não deixa espaço duplo quando uma variável fica vazia', () => {
    const r = montarMensagem('Olá {nome}, do {ente} aqui.', {
      ...LEAD_COMPLETO,
      enteDevedor: null,
    });
    expect(r).not.toContain('  ');
  });

  it('não deixa espaço antes de pontuação', () => {
    const r = montarMensagem('Precatório contra {ente}.', {
      ...LEAD_COMPLETO,
      enteDevedor: null,
    });
    expect(r).not.toMatch(/\s\./);
  });

  it('nunca escreve undefined nem null na mensagem', () => {
    const vazio: DadosLead = {
      nome: 'Fulano',
      valorProposta: null,
      valorProcesso: null,
      numeroProcesso: null,
      enteDevedor: null,
    };
    const r = montarMensagem('{nome} {valor} {ente} {processo}', vazio);
    expect(r).not.toContain('undefined');
    expect(r).not.toContain('null');
    expect(r).toBe('Fulano');
  });
});

describe('escolherModelo', () => {
  it('usa o mais completo quando o lead tem tudo', () => {
    expect(escolherModelo(MODELOS, LEAD_COMPLETO)?.id).toBe('completo');
  });

  it('desce pro modelo sem ente quando falta o ente', () => {
    const m = escolherModelo(MODELOS, { ...LEAD_COMPLETO, enteDevedor: null });
    expect(m?.id).toBe('com-valor');
  });

  it('desce pro simples quando falta valor', () => {
    const m = escolherModelo(MODELOS, {
      ...LEAD_COMPLETO,
      valorProposta: null,
      valorProcesso: null,
    });
    expect(m?.id).toBe('simples');
  });

  it('o modelo escolhido nunca produz mensagem com buraco', () => {
    const semNada: DadosLead = {
      nome: 'Fulano',
      valorProposta: null,
      valorProcesso: null,
      numeroProcesso: null,
      enteDevedor: null,
    };
    const m = escolherModelo(MODELOS, semNada)!;
    const texto = montarMensagem(m.texto, semNada);
    expect(texto).toBe('Olá Fulano, aqui é da RGT Capital.');
  });

  it('lead novo nunca recebe a retomada, mesmo sem dado nenhum', () => {
    const semNada: DadosLead = {
      nome: 'Fulano',
      valorProposta: null,
      valorProcesso: null,
      numeroProcesso: null,
      enteDevedor: null,
    };
    expect(escolherModelo(MODELOS, semNada)?.id).toBe('simples');
    expect(escolherModelo(MODELOS, semNada, 'primeiro_contato')?.id).toBe('simples');
  });

  it('lead já contatado recebe a retomada, mesmo tendo valor e ente', () => {
    expect(escolherModelo(MODELOS, LEAD_COMPLETO, 'retomada')?.id).toBe('retomada');
  });

  it('sem retomada ativa, o lead contatado recebe o primeiro contato', () => {
    const semRetomada = MODELOS.filter((m) => m.uso !== 'retomada');
    expect(escolherModelo(semRetomada, LEAD_COMPLETO, 'retomada')?.id).toBe('completo');
  });

  it('devolve null quando nenhum modelo serve', () => {
    const soCompleto = [MODELOS[0]!];
    const m = escolherModelo(soCompleto, {
      ...LEAD_COMPLETO,
      valorProposta: null,
      valorProcesso: null,
    });
    expect(m).toBeNull();
  });
});

describe('linkWhatsAppComTexto', () => {
  it('monta o link com DDI e texto codificado', () => {
    const l = linkWhatsAppComTexto('82999998888', 'Olá José');
    expect(l).toBe('https://wa.me/5582999998888?text=Ol%C3%A1%20Jos%C3%A9');
  });

  it('aceita telefone com máscara', () => {
    const l = linkWhatsAppComTexto('(82) 99999-8888', 'oi');
    expect(l).toContain('wa.me/5582999998888');
  });

  it('não duplica o DDI em número que já tem', () => {
    const l = linkWhatsAppComTexto('5582999998888', 'oi');
    expect(l).toContain('wa.me/5582999998888');
    expect(l).not.toContain('wa.me/555582');
  });

  it('corta texto longo demais pra não quebrar a URL', () => {
    const longo = 'a'.repeat(3000);
    const l = linkWhatsAppComTexto('82999998888', longo);
    // 1200 'a' viram 1200 caracteres na URL (sem escape pra letra simples)
    expect(l.length).toBeLessThan(1400);
  });

  it('escapa quebra de linha, que é comum em mensagem de contato', () => {
    const l = linkWhatsAppComTexto('82999998888', 'linha 1\nlinha 2');
    expect(l).toContain('%0A');
  });
});

describe('formatarEnte', () => {
  it('transforma estado cru da planilha em nome apresentável', () => {
    // A planilha do TRT19 entrega "ALAGOAS"; "crédito a receber de ALAGOAS"
    // soa como erro de sistema na mensagem que vai pro credor.
    expect(formatarEnte('ALAGOAS')).toBe('Estado de Alagoas');
    expect(formatarEnte('PERNAMBUCO')).toBe('Estado de Pernambuco');
  });

  it('devolve o acento que a planilha não tem', () => {
    expect(formatarEnte('SAO PAULO')).toBe('Estado de São Paulo');
    expect(formatarEnte('PARA')).toBe('Estado de Pará');
    expect(formatarEnte('MARANHAO')).toBe('Estado de Maranhão');
  });

  it('preserva siglas em caixa alta', () => {
    // "Inss" lê como erro de digitação
    expect(formatarEnte('INSS')).toBe('INSS');
    expect(formatarEnte('INCRA')).toBe('INCRA');
    expect(formatarEnte('ect')).toBe('ECT');
  });

  it('deixa preposição em minúscula em nome composto', () => {
    expect(formatarEnte('MUNICIPIO DE MACEIO')).toBe('Municipio de Maceio');
    expect(formatarEnte('PREFEITURA DA CAPITAL')).toBe('Prefeitura da Capital');
  });

  it('não quebra com entrada vazia ou nula', () => {
    expect(formatarEnte(null)).toBeNull();
    expect(formatarEnte('')).toBeNull();
    expect(formatarEnte('   ')).toBeNull();
  });

  it('chega formatado na mensagem final', () => {
    const r = montarMensagem('crédito contra {ente}', {
      nome: 'José',
      valorProposta: null,
      valorProcesso: null,
      numeroProcesso: null,
      enteDevedor: 'ALAGOAS',
    });
    expect(r).toBe('crédito contra Estado de Alagoas');
  });
});

/**
 * O modelo escreve "contra {ente}" e saía "contra Estado de Alagoas", sem o
 * artigo. Pôr "o" direto no modelo não resolve: o mesmo campo pode ser
 * "União", e viraria "contra o União". Daí a variável separada.
 */
describe('artigoDoEnte', () => {
  it('Estado e Município são masculinos', () => {
    expect(artigoDoEnte('Estado de Alagoas')).toBe('o');
    expect(artigoDoEnte('Município de Maceió')).toBe('o');
  });

  it('União é feminina', () => {
    expect(artigoDoEnte('União')).toBe('a');
  });

  it('sigla não entrega o gênero — tem que ser na mão', () => {
    // O substantivo escondido manda: Instituto x Agência x Universidade.
    expect(artigoDoEnte('INSS')).toBe('o');
    expect(artigoDoEnte('IFAL')).toBe('o');
    expect(artigoDoEnte('ANAC')).toBe('a');
    expect(artigoDoEnte('UFAL')).toBe('a');
  });

  it('nomes por extenso pelo começo da palavra', () => {
    expect(artigoDoEnte('Prefeitura de Arapiraca')).toBe('a');
    expect(artigoDoEnte('Universidade Federal de Alagoas')).toBe('a');
    expect(artigoDoEnte('Defensoria Pública do Estado de Alagoas')).toBe('a');
    expect(artigoDoEnte('Departamento de Estradas')).toBe('o');
  });
});

describe('enteComArtigo', () => {
  it('monta o ente já com artigo, a partir do valor cru', () => {
    expect(enteComArtigo('ALAGOAS')).toBe('o Estado de Alagoas');
    expect(enteComArtigo('união')).toBe('a União');
  });

  it('ente vazio não vira artigo solto', () => {
    expect(enteComArtigo(null)).toBe('');
    expect(enteComArtigo('   ')).toBe('');
  });
});

describe('{o_ente} na mensagem', () => {
  const LEAD = {
    nome: 'José',
    valorProposta: null,
    valorProcesso: null,
    numeroProcesso: null,
    enteDevedor: 'ALAGOAS',
  };

  it('a frase que motivou tudo isso', () => {
    expect(montarMensagem('crédito contra {o_ente}', LEAD)).toBe(
      'crédito contra o Estado de Alagoas',
    );
  });

  it('concorda com ente feminino', () => {
    expect(montarMensagem('crédito contra {o_ente}', { ...LEAD, enteDevedor: 'União' })).toBe(
      'crédito contra a União',
    );
  });

  it('{ente} continua sem artigo, pra quem usa em outra posição', () => {
    expect(montarMensagem('do {ente} aqui', LEAD)).toBe('do Estado de Alagoas aqui');
  });

  it('os dois no mesmo texto não se atrapalham', () => {
    // A troca é literal: se {ente} fosse trocado primeiro, sobraria "{o_".
    expect(montarMensagem('{o_ente} / {ente}', LEAD)).toBe(
      'o Estado de Alagoas / Estado de Alagoas',
    );
  });

  it('sem ente, não sobra artigo nem espaço duplo', () => {
    const r = montarMensagem('crédito contra {o_ente}.', { ...LEAD, enteDevedor: null });
    expect(r).toBe('crédito contra.');
    expect(r).not.toMatch(/\bo\s*\./);
  });
});
