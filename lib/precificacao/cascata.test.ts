import { describe, expect, it } from 'vitest';
import { montarCascata } from './cascata';
import type { EntradaCascata } from './tipos';

/**
 * Caso de referência: precatório 0502141-84.2025.8.02.9003 do TJAL,
 * expedido em 12/06/2025, fornecido pelo Renato em 19/10/2026.
 *
 * Servidor do próprio TJAL, ação de reintegração contra o Estado de Alagoas.
 * Natureza alimentar, sem cessionário. Os números abaixo são literais do
 * documento — se um teste aqui quebrar, ou o documento mudou ou a conta
 * passou a divergir do que o tribunal homologou.
 *
 * O ofício separa dois beneficiários no mesmo precatório:
 *   Rubem (credor)     principal 523.601,59 + Selic 192.123,79 + juros 221.642,00
 *   José (advogado)    principal  52.360,16 + Selic  41.376,58
 *                      honorários sucumbenciais, recebe direto do ente
 *
 * A RGT compraria apenas a parte do Rubem.
 */
const RUBEM = {
  principal: 523601.59,
  selic: 192123.79,
  juros: 221642.0,
  pssValor: 57596.17,
  rraMeses: 83,
  dataBase: '2024-02-16',
} as const;

const JOSE_SUCUMBENCIA = 52360.16 + 41376.58;
const VALOR_GLOBAL_OFICIO = 1031104.12;

function entradaBase(over: Partial<EntradaCascata> = {}): EntradaCascata {
  return {
    composicao: {
      principal: RUBEM.principal,
      juros: RUBEM.juros,
      correcao: RUBEM.selic,
      dataBase: RUBEM.dataBase,
      indice: 'selic',
    },
    deducoes: {
      pssValor: RUBEM.pssValor,
      pssIncide: true,
      honorariosContratuaisValor: null,
      honorariosContratuaisPct: null,
      cessaoAnterior: null,
      penhora: null,
      compensacaoTributaria: null,
    },
    tributacao: { rraAtivo: true, rraMeses: RUBEM.rraMeses },
    dataFinal: '2026-10-19',
    fatorCorrecao: 1,
    ...over,
  };
}

const linha = (r: ReturnType<typeof montarCascata>, id: string) =>
  r.linhas.find((l) => l.id === id);

describe('cascata — conferência contra o ofício do TJAL', () => {
  it('o bruto na data-base reproduz o valor do beneficiário no documento', () => {
    const r = montarCascata(entradaBase());
    // 523.601,59 + 221.642,00 + 192.123,79
    expect(linha(r, 'bruto-data-base')?.valor).toBe(937367.38);
  });

  it('bruto do credor mais sucumbência do advogado fecha o valor global', () => {
    const r = montarCascata(entradaBase());
    const bruto = linha(r, 'bruto-data-base')!.valor!;
    expect(Math.round((bruto + JOSE_SUCUMBENCIA) * 100) / 100).toBe(VALOR_GLOBAL_OFICIO);
  });

  it('o PSS do ofício corresponde a 11% do principal', () => {
    // Confirma a alíquota do art. 16-A sem precisar supor: o documento dá o
    // valor, e a divisão fecha em 11,0%.
    const pct = (RUBEM.pssValor / RUBEM.principal) * 100;
    expect(pct).toBeCloseTo(11, 1);
  });

  it('exibe o percentual do PSS calculado a partir do valor', () => {
    const r = montarCascata(entradaBase());
    expect(linha(r, 'pss')?.detalhe).toBe('11.0% sobre o principal');
    expect(linha(r, 'pss')?.origem).toBe('oficio');
  });

  it('chega no líquido antes do IR descontando só o PSS', () => {
    const r = montarCascata(entradaBase());
    // 937.367,38 − 57.596,17
    expect(r.liquidoDisponivel).toBe(879771.21);
  });

  it('marca como provisório porque o IR sobre RRA ainda não é calculado', () => {
    const r = montarCascata(entradaBase());
    expect(r.provisorio).toBe(true);
    expect(linha(r, 'liquido')?.rotulo).toBe('Líquido disponível (antes do IR)');
    expect(linha(r, 'ir')?.origem).toBe('falta');
    expect(linha(r, 'ir')?.detalhe).toContain('83 meses');
  });

  it('não desconta honorários sucumbenciais do credor', () => {
    // O advogado é beneficiário próprio no ofício e recebe direto do ente.
    // Tratar como dedução tiraria R$ 93.736,74 a mais do credor.
    const r = montarCascata(entradaBase());
    const ids = r.linhas.map((l) => l.id);
    expect(ids).not.toContain('honorarios-sucumbenciais');
    expect(r.liquidoDisponivel).toBe(879771.21);
  });
});

describe('cascata — correção monetária do período', () => {
  it('aplica o fator sobre o bruto da data-base', () => {
    const r = montarCascata(entradaBase({ fatorCorrecao: 1.2578 }));
    // 937.367,38 × 1,2578
    expect(r.brutoAtualizado).toBe(1179020.69);
    expect(linha(r, 'correcao-periodo')?.valor).toBe(241653.31);
    expect(linha(r, 'correcao-periodo')?.origem).toBe('calculado');
  });

  it('o líquido acompanha o bruto corrigido', () => {
    const r = montarCascata(entradaBase({ fatorCorrecao: 1.2578 }));
    expect(r.liquidoDisponivel).toBe(1121424.52);
  });

  it('bloqueia o total quando a série não cobre o período', () => {
    const r = montarCascata(entradaBase({ fatorCorrecao: null }));
    expect(r.liquidoDisponivel).toBeNull();
    expect(linha(r, 'correcao-periodo')?.origem).toBe('falta');
    expect(r.bloqueios.some((b) => b.campo === 'fatorCorrecao' && b.impedeTotal)).toBe(true);
  });

  it('nomeia o índice do ofício, não um padrão', () => {
    const r = montarCascata(entradaBase());
    expect(linha(r, 'correcao-oficio')?.rotulo).toContain('Selic');
    const comIpca = montarCascata(
      entradaBase({
        composicao: { ...entradaBase().composicao, indice: 'ipca' },
      }),
    );
    expect(linha(comIpca, 'correcao-oficio')?.rotulo).toContain('IPCA');
  });
});

describe('cascata — falta não vira zero', () => {
  it('bloqueia quando o ofício indica PSS mas o valor não veio', () => {
    const r = montarCascata(
      entradaBase({
        deducoes: { ...entradaBase().deducoes, pssValor: null },
      }),
    );
    expect(linha(r, 'pss')?.valor).toBeNull();
    expect(linha(r, 'pss')?.origem).toBe('falta');
    expect(r.liquidoDisponivel).toBeNull();
    expect(r.bloqueios.some((b) => b.campo === 'pssValor' && b.impedeTotal)).toBe(true);
  });

  it('zero declarado é diferente de ausente', () => {
    const r = montarCascata(
      entradaBase({
        deducoes: { ...entradaBase().deducoes, pssIncide: false, pssValor: null },
      }),
    );
    expect(linha(r, 'pss')?.valor).toBe(0);
    expect(linha(r, 'pss')?.origem).toBe('oficio');
    expect(r.liquidoDisponivel).toBe(937367.38);
  });

  it('não inventa IR quando o ofício não indica RRA', () => {
    const r = montarCascata(entradaBase({ tributacao: { rraAtivo: false, rraMeses: null } }));
    expect(linha(r, 'ir')?.valor).toBe(0);
    expect(r.provisorio).toBe(false);
    expect(linha(r, 'liquido')?.rotulo).toBe('Líquido disponível');
  });
});

describe('cascata — deduções opcionais', () => {
  it('desconta honorários contratuais por percentual', () => {
    const r = montarCascata(
      entradaBase({
        deducoes: { ...entradaBase().deducoes, honorariosContratuaisPct: 20 },
      }),
    );
    // 20% de 937.367,38
    expect(linha(r, 'honorarios-contratuais')?.valor).toBe(187473.48);
    expect(r.liquidoDisponivel).toBe(937367.38 - RUBEM.pssValor - 187473.48);
  });

  it('valor digitado tem precedência sobre o percentual', () => {
    const r = montarCascata(
      entradaBase({
        deducoes: {
          ...entradaBase().deducoes,
          honorariosContratuaisPct: 20,
          honorariosContratuaisValor: 100000,
        },
      }),
    );
    expect(linha(r, 'honorarios-contratuais')?.valor).toBe(100000);
    expect(linha(r, 'honorarios-contratuais')?.origem).toBe('digitado');
  });

  it('omite gravames que não existem em vez de mostrar linha zerada', () => {
    const r = montarCascata(entradaBase());
    const ids = r.linhas.map((l) => l.id);
    expect(ids).not.toContain('cessao-anterior');
    expect(ids).not.toContain('penhora');
    expect(ids).not.toContain('compensacao');
  });

  it('desconta cessão anterior e cita a norma', () => {
    const r = montarCascata(
      entradaBase({
        deducoes: { ...entradaBase().deducoes, cessaoAnterior: 200000 },
      }),
    );
    expect(linha(r, 'cessao-anterior')?.valor).toBe(200000);
    expect(linha(r, 'cessao-anterior')?.norma).toBe('Res. CJF 983/2026, art. 22');
    expect(r.liquidoDisponivel).toBe(937367.38 - RUBEM.pssValor - 200000);
  });
});

describe('cascata — auditabilidade', () => {
  it('toda linha com valor declara de onde o número veio', () => {
    const r = montarCascata(entradaBase({ fatorCorrecao: 1.2578 }));
    for (const l of r.linhas) {
      if (l.valor !== null) expect(l.origem).not.toBe('falta');
      else expect(l.origem).toBe('falta');
    }
  });

  it('as linhas saem na ordem de leitura da conta', () => {
    const r = montarCascata(entradaBase({ fatorCorrecao: 1.2578 }));
    expect(r.linhas.map((l) => l.id)).toEqual([
      'principal',
      'juros',
      'correcao-oficio',
      'bruto-data-base',
      'correcao-periodo',
      'bruto-atualizado',
      'pss',
      'ir',
      'liquido',
    ]);
  });
});
