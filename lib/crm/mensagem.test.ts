import { describe, expect, it } from 'vitest';
import {
  escolherModelo,
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
  },
  {
    id: 'com-valor',
    nome: 'Só com valor',
    texto: 'Olá {nome}, aqui é da RGT sobre seu precatório de {valor}.',
    requerValor: true,
    requerEnte: false,
  },
  {
    id: 'simples',
    nome: 'Sem valor',
    texto: 'Olá {nome}, aqui é da RGT Capital.',
    requerValor: false,
    requerEnte: false,
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
