import { describe, expect, it } from 'vitest';
import { calcularIr } from './ir';

/**
 * Caso de referência da Lajedo: precatório ADILSON (TRF5), visto na
 * plataforma deles em 19/10/2026 com a conta de broker da RGT.
 *
 *   Valor Total do Crédito atualizado   R$ 506.140,11
 *   Valor Principal atualizado          R$ 423.629,16
 *   Meses RRA                                      96
 *   Valor de RRA apurado por eles       R$  30.469,76   (6,02% do total)
 *
 * Reproduzir esse número é o que prova que a base e a alíquota estão certas.
 */
const LAJEDO = {
  totalAtualizado: 506140.11,
  principalAtualizado: 423629.16,
  rraMeses: 96,
  irApurado: 30469.76,
} as const;

describe('IR — conferência contra o caso real da Lajedo', () => {
  it('reproduz o imposto deles com erro abaixo de 0,1%', () => {
    const r = calcularIr({
      base: LAJEDO.principalAtualizado,
      rraMeses: LAJEDO.rraMeses,
      modo: 'ultima_faixa',
    });
    const erroRelativo = Math.abs(r.valor - LAJEDO.irApurado) / LAJEDO.irApurado;
    expect(erroRelativo).toBeLessThan
      ? expect(erroRelativo).toBeLessThan(0.001)
      : expect(erroRelativo).toBeLessThan(0.001);
    expect(r.regime).toBe('rra');
  });

  it('a base é o principal, não o total do crédito', () => {
    // Usar o total infla o imposto em ~74% — seria R$ 53 mil em vez de 30 mil.
    const comTotal = calcularIr({
      base: LAJEDO.totalAtualizado,
      rraMeses: LAJEDO.rraMeses,
      modo: 'ultima_faixa',
    });
    const comPrincipal = calcularIr({
      base: LAJEDO.principalAtualizado,
      rraMeses: LAJEDO.rraMeses,
      modo: 'ultima_faixa',
    });
    expect(comTotal.valor).toBeGreaterThan(LAJEDO.irApurado * 1.5);
    expect(Math.abs(comPrincipal.valor - LAJEDO.irApurado)).toBeLessThan(20);
  });
});

describe('IR — os dois regimes', () => {
  it('meses maior que zero aplica RRA', () => {
    const r = calcularIr({ base: 423629.16, rraMeses: 96 });
    expect(r.regime).toBe('rra');
    expect(r.detalhe).toContain('96 meses');
  });

  it('meses zero aplica a retenção fixa de 3%', () => {
    // Regra que a própria interface da Lajedo enuncia:
    // "Se incidir IR e meses = 0, aplica IR fixo de 3%."
    const r = calcularIr({ base: 100000, rraMeses: 0 });
    expect(r.regime).toBe('fixo_3');
    expect(r.valor).toBe(3000);
    expect(r.aliquotaEfetiva).toBe(3);
  });

  it('meses nulo também cai no fixo de 3%', () => {
    const r = calcularIr({ base: 100000, rraMeses: null });
    expect(r.regime).toBe('fixo_3');
    expect(r.valor).toBe(3000);
  });

  it('base zerada não gera imposto', () => {
    const r = calcularIr({ base: 0, rraMeses: 96 });
    expect(r.regime).toBe('isento');
    expect(r.valor).toBe(0);
  });
});

describe('IR — conservador versus progressivo', () => {
  it('o padrão é o progressivo, que é o que a lei manda', () => {
    const padrao = calcularIr({ base: 423629.16, rraMeses: 96 });
    const progressivo = calcularIr({ base: 423629.16, rraMeses: 96, modo: 'progressivo' });
    expect(padrao.valor).toBe(progressivo.valor);
  });

  it('a última faixa SUBESTIMA o imposto na faixa intermediária', () => {
    // Armadilha: 423.629,16 ÷ 96 = R$ 4.412,80/mês cai na faixa de 22,5%.
    // Aplicar 27,5% parece provisionar mais, mas a dedução da última faixa
    // (896,00 contra 662,77) derruba o resultado. É por isso que o padrão
    // é o progressivo e não este modo.
    const ultimaFaixa = calcularIr({ base: 423629.16, rraMeses: 96, modo: 'ultima_faixa' });
    const progressivo = calcularIr({ base: 423629.16, rraMeses: 96, modo: 'progressivo' });
    expect(ultimaFaixa.valor).toBeLessThan(progressivo.valor);
    expect(progressivo.valor - ultimaFaixa.valor).toBeGreaterThan(1000);
    expect(progressivo.detalhe).toContain('progressiva');
    expect(ultimaFaixa.detalhe).toContain('conferência');
  });

  it('acima do teto da tabela os dois modos coincidem', () => {
    // Base mensal alta já estaria na última faixa de qualquer jeito.
    const base = 523601.59;
    const meses = 83; // R$ 6.308,45/mês, acima de 4.664,68
    const c = calcularIr({ base, rraMeses: meses, modo: 'ultima_faixa' });
    const p = calcularIr({ base, rraMeses: meses, modo: 'progressivo' });
    expect(c.valor).toBe(p.valor);
  });

  it('informa a alíquota efetiva pra quem for conferir', () => {
    const r = calcularIr({ base: 523601.59, rraMeses: 83 });
    // RRA derruba a alíquota efetiva bem abaixo da nominal
    expect(r.aliquotaEfetiva).toBeGreaterThan(10);
    expect(r.aliquotaEfetiva).toBeLessThan(20);
  });
});

describe('IR — efeito do RRA', () => {
  it('mais meses diluem a base e reduzem o imposto', () => {
    const base = 500000;
    const curto = calcularIr({ base, rraMeses: 12, modo: 'progressivo' });
    const longo = calcularIr({ base, rraMeses: 120, modo: 'progressivo' });
    expect(longo.valor).toBeLessThan(curto.valor);
  });

  it('meses suficientes podem zerar o imposto pela faixa de isenção', () => {
    // 100.000 em 60 meses = R$ 1.666,67/mês, abaixo do limite de isenção
    const r = calcularIr({ base: 100000, rraMeses: 60, modo: 'progressivo' });
    expect(r.valor).toBe(0);
  });
});
