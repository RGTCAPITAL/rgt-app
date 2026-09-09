import { describe, expect, it } from 'vitest';
import {
  calcularFator,
  competenciaDe,
  competenciasEntre,
  proximaCompetencia,
  type PontoPersistido,
} from './fator';

function ponto(
  competencia: string,
  variacao_pct: number,
  numero_indice: number | null = null,
): PontoPersistido {
  return { competencia, variacao_pct, numero_indice };
}

describe('competenciaDe', () => {
  it('normaliza qualquer dia do mês para o dia 1', () => {
    expect(competenciaDe('2026-03-15')).toBe('2026-03-01');
    expect(competenciaDe('2026-03-01')).toBe('2026-03-01');
    expect(competenciaDe('2026-03-31')).toBe('2026-03-01');
  });
});

describe('proximaCompetencia', () => {
  it('avança um mês', () => {
    expect(proximaCompetencia('2026-03-01')).toBe('2026-04-01');
  });

  it('vira o ano em dezembro', () => {
    expect(proximaCompetencia('2026-12-01')).toBe('2027-01-01');
  });

  it('mantém o zero à esquerda', () => {
    expect(proximaCompetencia('2026-08-01')).toBe('2026-09-01');
  });
});

describe('competenciasEntre', () => {
  it('inclui as duas pontas', () => {
    expect(competenciasEntre('2026-01-01', '2026-03-01')).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
  });

  it('atravessa a virada de ano', () => {
    expect(competenciasEntre('2026-11-01', '2027-02-01')).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
    ]);
  });

  it('devolve vazio quando o intervalo é invertido', () => {
    expect(competenciasEntre('2026-05-01', '2026-02-01')).toEqual([]);
  });
});

describe('calcularFator — convenção de competências', () => {
  // O índice do mês da data-base NÃO se aplica: o valor já está expresso nele.
  it('não aplica o índice do próprio mês da data-base', () => {
    const pontos = [
      ponto('2026-01-01', 99), // se fosse aplicado, o fator explodiria
      ponto('2026-02-01', 1),
    ];
    const r = calcularFator(pontos, '2026-01-15', '2026-02-20');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fator).toBeCloseTo(1.01, 10);
    expect(r.mesesAplicados).toBe(1);
  });

  it('devolve fator 1 quando base e final são o mesmo mês', () => {
    const r = calcularFator([ponto('2026-03-01', 5)], '2026-03-02', '2026-03-28');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fator).toBe(1);
    expect(r.mesesAplicados).toBe(0);
  });

  it('recusa data final anterior à data-base', () => {
    const r = calcularFator([], '2026-06-10', '2026-03-10');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toMatch(/anterior/i);
  });
});

describe('calcularFator — encadeamento', () => {
  it('multiplica as variações do mês seguinte ao da base até o final', () => {
    const pontos = [ponto('2026-01-01', 0.5), ponto('2026-02-01', 1.0), ponto('2026-03-01', 2.0)];
    const r = calcularFator(pontos, '2026-01-10', '2026-03-10');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // (1 + 1%) × (1 + 2%)
    expect(r.fator).toBeCloseTo(1.01 * 1.02, 10);
    expect(r.metodo).toBe('encadeamento');
    expect(r.mesesAplicados).toBe(2);
  });

  it('lida com variação negativa (deflação)', () => {
    const pontos = [ponto('2026-06-01', 0.16), ponto('2026-07-01', -0.4)];
    const r = calcularFator(pontos, '2026-06-05', '2026-07-05');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fator).toBeCloseTo(0.996, 10);
  });

  it('FALHA quando falta competência no meio — nunca devolve fator parcial', () => {
    const pontos = [
      ponto('2026-01-01', 0.5),
      // fevereiro ausente de propósito
      ponto('2026-03-01', 2.0),
    ];
    const r = calcularFator(pontos, '2026-01-10', '2026-03-10');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain('2026-02-01');
  });

  it('FALHA quando a série está totalmente vazia', () => {
    const r = calcularFator([], '2026-01-10', '2026-03-10');
    expect(r.ok).toBe(false);
  });
});

describe('calcularFator — número-índice', () => {
  it('prefere número-índice quando disponível nas duas pontas', () => {
    const pontos = [
      ponto('2026-04-01', 0.67, 7596.09),
      ponto('2026-05-01', 0.58, 7640.15),
      ponto('2026-06-01', 0.16, 7652.37),
      ponto('2026-07-01', 0.07, 7657.73),
    ];
    const r = calcularFator(pontos, '2026-04-20', '2026-07-20');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.metodo).toBe('numero_indice');
    // Valores reais do IPCA (IBGE agregado 1737, variável 2266)
    expect(r.fator).toBeCloseTo(7657.73 / 7596.09, 10);
  });

  it('número-índice e encadeamento convergem, mas divergem em casas altas', () => {
    const comIndice = [
      ponto('2026-04-01', 0.67, 7596.09),
      ponto('2026-05-01', 0.58, 7640.15),
      ponto('2026-06-01', 0.16, 7652.37),
      ponto('2026-07-01', 0.07, 7657.73),
    ];
    const semIndice = comIndice.map((p) => ({ ...p, numero_indice: null }));

    const a = calcularFator(comIndice, '2026-04-20', '2026-07-20');
    const b = calcularFator(semIndice, '2026-04-20', '2026-07-20');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    // Concordam no grosso...
    expect(a.fator).toBeCloseTo(b.fator, 5);
    // ...mas não são idênticos: é exatamente a deriva do arredondamento em 2
    // casas que motiva preferir o número-índice em créditos antigos.
    expect(a.fator).not.toBe(b.fator);
  });

  it('cai pro encadeamento se falta número-índice numa das pontas', () => {
    const pontos = [
      ponto('2026-04-01', 0.67, 7596.09),
      ponto('2026-05-01', 0.58, null), // ponta final sem número-índice
    ];
    const r = calcularFator(pontos, '2026-04-20', '2026-05-20');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.metodo).toBe('encadeamento');
    expect(r.fator).toBeCloseTo(1.0058, 10);
  });

  it('ignora número-índice zerado em vez de dividir por zero', () => {
    const pontos = [ponto('2026-04-01', 0.67, 0), ponto('2026-05-01', 0.58, 7640.15)];
    const r = calcularFator(pontos, '2026-04-20', '2026-05-20');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.metodo).toBe('encadeamento');
    expect(Number.isFinite(r.fator)).toBe(true);
  });
});

describe('calcularFator — casos longos', () => {
  it('corrige por 200+ meses sem estourar', () => {
    const pontos: PontoPersistido[] = [];
    let comp = '2009-01-01';
    for (let i = 0; i < 210; i++) {
      pontos.push(ponto(comp, 0.5));
      comp = proximaCompetencia(comp);
    }
    const ultima = pontos[pontos.length - 1]!.competencia;
    const r = calcularFator(pontos, '2009-01-15', ultima);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mesesAplicados).toBe(209);
    expect(r.fator).toBeCloseTo(Math.pow(1.005, 209), 6);
  });
});
