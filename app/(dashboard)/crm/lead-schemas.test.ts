import { describe, expect, it } from 'vitest';
import { leadFormSchema, valorParaNumero } from './lead-schemas';

const BASE = {
  nome: 'José Ribamar da Silva',
  telefone: '(82) 99123-4567',
  email: '',
  cpf_cnpj: '',
  origem: 'indicacao' as const,
  dono_id: '',
  notas: '',
};

describe('valorParaNumero', () => {
  it('lê o formato que a pessoa digita de verdade', () => {
    // Milhar com ponto, decimal com vírgula — como sai de qualquer
    // planilha ou extrato brasileiro.
    expect(valorParaNumero('187.430,50')).toBe(187430.5);
    expect(valorParaNumero('1.234.567,89')).toBe(1234567.89);
  });

  it('aceita só a vírgula, sem separador de milhar', () => {
    expect(valorParaNumero('187430,50')).toBe(187430.5);
  });

  it('trata ponto como decimal quando não há vírgula', () => {
    // Quem vem de teclado numérico ou copia de sistema em inglês digita
    // "187430.50" — e isso também precisa funcionar.
    expect(valorParaNumero('187430.50')).toBe(187430.5);
    expect(valorParaNumero('187430')).toBe(187430);
  });

  it('ignora R$ e espaços colados pela pessoa', () => {
    expect(valorParaNumero('R$ 187.430,50')).toBe(187430.5);
    expect(valorParaNumero(' 187430 ')).toBe(187430);
  });

  it('devolve NaN pra texto que não é valor, em vez de zero', () => {
    // Zero silencioso aqui gravaria um precatório de R$ 0,00 no banco.
    expect(valorParaNumero('abc')).toBeNaN();
    expect(valorParaNumero('')).toBeNaN();
  });
});

describe('leadFormSchema — dados do precatório', () => {
  it('aceita lead sem nenhum dado de precatório', () => {
    // O caso mais comum: indicação com nome e telefone, nada mais.
    const r = leadFormSchema.safeParse(BASE);
    expect(r.success).toBe(true);
  });

  it('aceita os três campos preenchidos', () => {
    const r = leadFormSchema.safeParse({
      ...BASE,
      ente_devedor: 'Estado de Alagoas',
      numero_processo: '0001107-33.2017.5.19.0001',
      valor_processo: '187.430,50',
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.ente_devedor).toBe('Estado de Alagoas');
  });

  it('recusa valor que não é número', () => {
    const r = leadFormSchema.safeParse({ ...BASE, valor_processo: 'uns duzentos mil' });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0]?.message).toBe('Valor inválido');
  });

  it('recusa valor negativo', () => {
    const r = leadFormSchema.safeParse({ ...BASE, valor_processo: '-5000' });
    expect(r.success).toBe(false);
  });

  it('tira espaço sobrando do nome do ente', () => {
    const r = leadFormSchema.safeParse({ ...BASE, ente_devedor: '  Estado de Alagoas  ' });
    expect(r.success && r.data.ente_devedor).toBe('Estado de Alagoas');
  });
});

/**
 * O "+" é o único sinal de que o número não é brasileiro. Antes ele era
 * descartado junto com os outros não-dígitos, e aí "+1 415 555 0100" virava
 * "14155550100" — que o fmtTelefone lia como DDD 14 (Marília) e exibia
 * "(14) 15555-0100". Com o "+" perdido na escrita, não há como corrigir na
 * exibição. Achado na revisão do 9ffb299.
 */
describe('telefone estrangeiro guarda o +', () => {
  const parse = (telefone: string) => leadFormSchema.parse({ ...BASE, telefone });

  it('número de outro país mantém o sinal', () => {
    expect(parse('+1 415 555 0100').telefone).toBe('+14155550100');
  });

  it('+55 vira dígito puro — é brasileiro e tem DDD', () => {
    expect(parse('+55 82 99123-4567').telefone).toBe('5582991234567');
  });

  it('número brasileiro sem + segue igual', () => {
    expect(parse('(82) 99123-4567').telefone).toBe('82991234567');
  });

  it('o + não conta no limite de 10-13 dígitos', () => {
    // 11 dígitos + o sinal = 12 caracteres; a validação olha só os dígitos.
    expect(() => parse('+1 415 555 0100')).not.toThrow();
    // E número curto demais continua sendo recusado, com ou sem +.
    expect(() => parse('+1 415')).toThrow();
  });
});
