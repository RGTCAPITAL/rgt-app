import { describe, expect, it } from 'vitest';
import { fmtTelefone } from './formatters';

describe('fmtTelefone', () => {
  it('celular com DDD', () => {
    expect(fmtTelefone('82991234567')).toBe('(82) 99123-4567');
  });

  it('fixo com DDD', () => {
    expect(fmtTelefone('8231234567')).toBe('(82) 3123-4567');
  });

  it('tira o 55 do país', () => {
    expect(fmtTelefone('5582991234567')).toBe('(82) 99123-4567');
    expect(fmtTelefone('558231234567')).toBe('(82) 3123-4567');
  });

  it('aceita o número já formatado', () => {
    expect(fmtTelefone('(82) 99123-4567')).toBe('(82) 99123-4567');
  });

  it('formato desconhecido volta como veio', () => {
    expect(fmtTelefone('991234567')).toBe('991234567');
    expect(fmtTelefone('+1 415 555 0100')).toBe('+1 415 555 0100');
  });

  it('vazio vira string vazia', () => {
    expect(fmtTelefone(null)).toBe('');
    expect(fmtTelefone('')).toBe('');
  });

  /**
   * Achado na revisão do 9ffb299: a função pegava as duas primeiras casas como
   * DDD sem olhar o que eram. Nenhum DDD brasileiro tem 0, então número com 0
   * na frente saía com DDD inventado — e o lead aparecia errado no cartão do
   * CRM sem ninguém desconfiar, porque o resultado *parece* um telefone.
   */
  describe('zero na frente não vira DDD', () => {
    it('0800 continua 0800', () => {
      expect(fmtTelefone('08001234567')).toBe('08001234567');
      expect(fmtTelefone('0800 123 4567')).toBe('0800 123 4567');
    });

    it('número anotado com o 0 da operadora volta cru', () => {
      // Antes virava "(08) 23123-4567".
      expect(fmtTelefone('08231234567')).toBe('08231234567');
    });

    it('0 na segunda casa também não é DDD', () => {
      // Não existe DDD 10, 20, 30… — se aparecer, é outra coisa.
      expect(fmtTelefone('10991234567')).toBe('10991234567');
      expect(fmtTelefone('2031234567')).toBe('2031234567');
    });

    it('e o 55 do país não mascara o problema', () => {
      // "55" + "0800…" tem 13 dígitos e entrava no caminho do DDD.
      expect(fmtTelefone('5508001234567')).toBe('5508001234567');
    });

    it('DDD de verdade com 0 no meio do número segue formatando', () => {
      // A guarda olha só as duas primeiras casas; 0 depois é normal.
      expect(fmtTelefone('82990001234')).toBe('(82) 99000-1234');
    });
  });
});
