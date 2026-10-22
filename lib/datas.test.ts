import { describe, expect, it } from 'vitest';
import { hojeEmSaoPaulo, somarDias } from './datas';

describe('somarDias', () => {
  it('soma dentro do mês, vira mês e vira ano', () => {
    expect(somarDias('2026-10-22', 1)).toBe('2026-10-23');
    expect(somarDias('2026-10-31', 1)).toBe('2026-11-01');
    expect(somarDias('2026-12-25', 15)).toBe('2027-01-09');
  });

  it('zero dias devolve a mesma data', () => {
    expect(somarDias('2026-10-22', 0)).toBe('2026-10-22');
  });
});

describe('hojeEmSaoPaulo', () => {
  it('às 22h de Maceió ainda é hoje, mesmo já sendo amanhã em UTC', () => {
    // 22/10 22:00 em Brasília = 23/10 01:00 UTC
    expect(hojeEmSaoPaulo(new Date('2026-10-23T01:00:00Z'))).toBe('2026-10-22');
  });

  it('vira o dia à meia-noite de Brasília, não à de Greenwich', () => {
    expect(hojeEmSaoPaulo(new Date('2026-10-23T02:59:59Z'))).toBe('2026-10-22');
    expect(hojeEmSaoPaulo(new Date('2026-10-23T03:00:00Z'))).toBe('2026-10-23');
  });

  it('formata com zero à esquerda', () => {
    expect(hojeEmSaoPaulo(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05');
  });
});
