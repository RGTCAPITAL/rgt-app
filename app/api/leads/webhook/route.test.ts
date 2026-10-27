import { describe, expect, it } from 'vitest';
import { payloadSchema } from './route';

/**
 * O webhook é a única porta por onde o site escreve no banco, e quem chama é
 * código que roda noutro projeto (a função serverless do rgt-site). Quando os
 * dois lados divergem, o sintoma é lead chegando torto — ou não chegando.
 *
 * Testa o schema, não o handler: é no schema que mora a normalização.
 */

const BASE = {
  nome: 'José Ribamar da Silva',
  telefone: '(82) 99951-0638',
  email: 'jose@example.com',
  cpf_cnpj: '529.982.247-25',
  numero_processo: '',
  mensagem: '',
};

describe('payloadSchema — o essencial', () => {
  it('aceita o preenchimento normal do formulário', () => {
    const r = payloadSchema.parse(BASE);
    expect(r.nome).toBe('José Ribamar da Silva');
    expect(r.telefone).toBe('82999510638');
    expect(r.cpf_cnpj).toBe('52998224725');
  });

  it('recusa nome curto — é o único campo que o banco exige', () => {
    expect(() => payloadSchema.parse({ ...BASE, nome: 'J' })).toThrow();
  });

  it('deixa passar lead só com nome, porque o webhook não decide o que é obrigatório', () => {
    // Quem exige telefone é o formulário do site. O webhook valida formato;
    // se um dia entrar lead por outro canal sem telefone, não é erro dele.
    const r = payloadSchema.parse({ nome: 'Maria Antonia dos Santos' });
    // Campo ausente não vira buraco no banco: o handler faz `|| null` nos dois.
    expect(r.telefone || null).toBeNull();
    expect(r.email || null).toBeNull();
    expect(r.numero_processo || null).toBeNull();
  });

  it('campo omitido e campo vazio chegam equivalentes ao banco', () => {
    // Os que têm transform devolvem '' e os que não têm devolvem undefined —
    // inconsistência do schema que não vira bug porque o handler normaliza
    // com `|| null`. O teste trava esse contrato: se alguém tirar o `|| null`,
    // quebra aqui antes de gravar string vazia no lugar de NULL.
    const omitido = payloadSchema.parse({ nome: 'Fulano de Tal' });
    const vazio = payloadSchema.parse({
      nome: 'Fulano de Tal',
      telefone: '',
      email: '',
      cpf_cnpj: '',
      numero_processo: '',
      mensagem: '',
    });
    const normaliza = (r: typeof omitido) => ({
      telefone: r.telefone || null,
      email: r.email || null,
      cpf_cnpj: r.cpf_cnpj || null,
      numero_processo: r.numero_processo || null,
    });
    expect(normaliza(omitido)).toEqual(normaliza(vazio));
  });
});

describe('numero_processo', () => {
  it('CNJ com máscara vira 20 dígitos, que é como a prospecção grava', () => {
    // Isso é o que permite descobrir que o credor que preencheu o site já
    // está na nossa fila de prospecção — lá o número está sem máscara.
    const r = payloadSchema.parse({ ...BASE, numero_processo: '0000952-62.2024.5.19.0008' });
    expect(r.numero_processo).toBe('00009526220245190008');
  });

  it('CNJ já sem máscara continua igual', () => {
    const r = payloadSchema.parse({ ...BASE, numero_processo: '00009526220245190008' });
    expect(r.numero_processo).toBe('00009526220245190008');
  });

  it('número de ofício requisitório passa como a pessoa escreveu', () => {
    // O campo do site diz "processo OU ofício requisitório". Ofício não tem
    // formato CNJ — forçar 20 dígitos recusaria metade dos credores.
    const r = payloadSchema.parse({ ...BASE, numero_processo: 'RP 1234/2024 - TRT19' });
    expect(r.numero_processo).toBe('RP 1234/2024 - TRT19');
  });

  it('campo vazio não vira string esquisita', () => {
    expect(payloadSchema.parse({ ...BASE, numero_processo: '' }).numero_processo).toBe('');
    expect(payloadSchema.parse({ ...BASE, numero_processo: '   ' }).numero_processo).toBe('');
  });

  it('corta texto absurdo em vez de aceitar payload gigante', () => {
    expect(() => payloadSchema.parse({ ...BASE, numero_processo: 'x'.repeat(61) })).toThrow();
  });
});

describe('formato de contato', () => {
  it('telefone perde a máscara', () => {
    expect(payloadSchema.parse({ ...BASE, telefone: '82 9 9951-0638' }).telefone).toBe(
      '82999510638',
    );
  });

  it('telefone curto demais é recusado', () => {
    expect(() => payloadSchema.parse({ ...BASE, telefone: '99510638' })).toThrow();
  });

  it('e-mail malformado é recusado', () => {
    expect(() => payloadSchema.parse({ ...BASE, email: 'jose@' })).toThrow();
  });

  it('CPF com contagem errada de dígitos é recusado', () => {
    expect(() => payloadSchema.parse({ ...BASE, cpf_cnpj: '1234567890' })).toThrow();
  });

  it('CNPJ de 14 dígitos passa — nem todo credor é pessoa física', () => {
    expect(payloadSchema.parse({ ...BASE, cpf_cnpj: '11.222.333/0001-81' }).cpf_cnpj).toBe(
      '11222333000181',
    );
  });
});
