import { describe, expect, it } from 'vitest';
import { decodificarCnj, digitosCnj } from './cnj';

describe('digitosCnj', () => {
  it('aceita CNJ mascarado e devolve só os dígitos', () => {
    expect(digitosCnj('0001107-33.2017.5.19.0001')).toBe('00011073320175190001');
  });

  it('recusa número com menos de 20 dígitos', () => {
    // CPF também é só número — se passasse, viraria "processo" no cadastro.
    expect(digitosCnj('123.456.789-00')).toBeNull();
    expect(digitosCnj('0001107-33.2017.5.19.000')).toBeNull();
  });

  it('recusa vazio e nulo', () => {
    expect(digitosCnj(null)).toBeNull();
    expect(digitosCnj('')).toBeNull();
  });
});

describe('decodificarCnj', () => {
  it('deriva TRT da região trabalhista', () => {
    // 5 = Justiça do Trabalho, 19 = Alagoas. É o formato da planilha do TRT19.
    expect(decodificarCnj('0001107-33.2017.5.19.0001')?.siglaTribunal).toBe('TRT19');
  });

  it('deriva TJ pelo código da UF', () => {
    expect(decodificarCnj('1000000-00.2020.8.26.0100')?.siglaTribunal).toBe('TJSP');
    expect(decodificarCnj('1000000-00.2020.8.02.0001')?.siglaTribunal).toBe('TJAL');
    expect(decodificarCnj('1000000-00.2020.8.19.0001')?.siglaTribunal).toBe('TJRJ');
  });

  it('deriva TRF pela região federal', () => {
    expect(decodificarCnj('1000000-00.2020.4.05.0000')?.siglaTribunal).toBe('TRF5');
  });

  it('reconhece tribunais superiores', () => {
    expect(decodificarCnj('1000000-00.2020.5.00.0000')?.siglaTribunal).toBe('TST');
    expect(decodificarCnj('1000000-00.2020.3.00.0000')?.siglaTribunal).toBe('STJ');
  });

  it('devolve ano de autuação', () => {
    expect(decodificarCnj('0001107-33.2017.5.19.0001')?.ano).toBe('2017');
  });

  it('devolve sigla nula quando o segmento não é jurisdicional', () => {
    // Segmento 2 é o próprio CNJ (processo administrativo) — não vira operação.
    const d = decodificarCnj('1000000-00.2020.2.00.0000');
    expect(d).not.toBeNull();
    expect(d?.siglaTribunal).toBeNull();
  });

  it('devolve sigla nula pra região de TRT inexistente', () => {
    expect(decodificarCnj('1000000-00.2020.5.99.0000')?.siglaTribunal).toBeNull();
  });
});
