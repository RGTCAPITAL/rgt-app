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
});
