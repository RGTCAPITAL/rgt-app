import { describe, expect, it } from 'vitest';
import {
  avaliarProposta,
  fatorVigente,
  fmtPercentual,
  fmtVigencia,
  precoPeloFator,
  type FatorLoa,
} from './desagio';

/**
 * O cenário destes testes é o que o Renato descreveu no áudio de 2026-10-20:
 * LOA 26 pagando 55% em outubro e 65% em novembro.
 */
const OUT: FatorLoa = {
  id: 'f-out',
  loaAno: 2026,
  percentual: 55,
  base: 'liquido',
  vigenteDesde: '2026-10-01',
  observacao: null,
};
const NOV: FatorLoa = {
  id: 'f-nov',
  loaAno: 2026,
  percentual: 65,
  base: 'liquido',
  vigenteDesde: '2026-11-01',
  observacao: 'mais perto do pagamento',
};
const LOA27: FatorLoa = {
  id: 'f-27',
  loaAno: 2027,
  percentual: 40,
  base: 'liquido',
  vigenteDesde: '2026-10-01',
  observacao: null,
};

const TODOS = [OUT, NOV, LOA27];

describe('fatorVigente', () => {
  it('pega o mais recente que já começou a valer', () => {
    expect(fatorVigente(TODOS, 2026, '2026-10-20')?.id).toBe('f-out');
    expect(fatorVigente(TODOS, 2026, '2026-11-05')?.id).toBe('f-nov');
  });

  it('vigência futura não vale hoje', () => {
    // Ele pode deixar novembro cadastrado em outubro sem mudar o preço de hoje.
    expect(fatorVigente(TODOS, 2026, '2026-10-31')?.percentual).toBe(55);
    expect(fatorVigente(TODOS, 2026, '2026-11-01')?.percentual).toBe(65);
  });

  it('o primeiro dia da vigência já conta', () => {
    expect(fatorVigente(TODOS, 2026, '2026-10-01')?.id).toBe('f-out');
  });

  it('data anterior a qualquer vigência não tem fator', () => {
    expect(fatorVigente(TODOS, 2026, '2026-09-30')).toBeNull();
  });

  it('não mistura LOAs', () => {
    // 2027 tem percentual próprio e menor — está mais longe do pagamento.
    expect(fatorVigente(TODOS, 2027, '2026-10-20')?.percentual).toBe(40);
    expect(fatorVigente(TODOS, 2029, '2026-10-20')).toBeNull();
  });

  it('não depende da ordem da lista', () => {
    const baguncado = [NOV, LOA27, OUT];
    expect(fatorVigente(baguncado, 2026, '2026-10-20')?.id).toBe('f-out');
  });
});

describe('precoPeloFator', () => {
  const VALORES = { face: 1_000_000, liquido: 600_000 };

  it('sobre o líquido', () => {
    expect(precoPeloFator(OUT, VALORES)).toBe(330_000);
  });

  it('sobre a face', () => {
    expect(precoPeloFator({ ...OUT, base: 'face' }, VALORES)).toBe(550_000);
  });

  it('a base muda o preço em centenas de milhares', () => {
    // É o motivo de `base` ser NOT NULL sem default no banco, e de a pergunta
    // ter ido pro Renato antes de ligar o cálculo. R$ 220 mil numa operação.
    const liquido = precoPeloFator(OUT, VALORES)!;
    const face = precoPeloFator({ ...OUT, base: 'face' }, VALORES)!;
    expect(face - liquido).toBe(220_000);
  });

  it('devolve null quando falta o valor que a base exige', () => {
    // Preço calculado sobre valor ausente seria número inventado com cara de
    // conta — a regra do módulo de precificação.
    expect(precoPeloFator(OUT, { face: 1_000_000, liquido: null })).toBeNull();
    expect(precoPeloFator({ ...OUT, base: 'face' }, { face: null, liquido: 600_000 })).toBeNull();
  });

  it('devolve null em valor zero ou negativo', () => {
    expect(precoPeloFator(OUT, { face: 0, liquido: 0 })).toBeNull();
    expect(precoPeloFator(OUT, { face: 0, liquido: -5 })).toBeNull();
  });

  it('percentual fracionário não perde centavo relevante', () => {
    const f = { ...OUT, percentual: 62.5 };
    expect(precoPeloFator(f, { face: null, liquido: 3_678_710.56 })).toBeCloseTo(2299194.1, 1);
  });
});

describe('avaliarProposta', () => {
  const BASE = { fatores: TODOS, hojeIso: '2026-10-20' };

  it('sem LOA preenchida não dá pra saber o percentual', () => {
    const r = avaliarProposta({ ...BASE, loaAno: null, fatorUsadoId: null, temProposta: false });
    expect(r.situacao).toBe('sem_loa');
  });

  it('LOA sem percentual cadastrado é estado próprio, não zero', () => {
    const r = avaliarProposta({ ...BASE, loaAno: 2029, fatorUsadoId: null, temProposta: false });
    expect(r.situacao).toBe('sem_fator');
    expect(r.situacao === 'sem_fator' && r.loaAno).toBe(2029);
  });

  it('sem proposta ainda, mostra o percentual vigente', () => {
    const r = avaliarProposta({ ...BASE, loaAno: 2026, fatorUsadoId: null, temProposta: false });
    expect(r.situacao).toBe('sem_proposta');
    expect(r.situacao === 'sem_proposta' && r.atual.percentual).toBe(55);
  });

  it('proposta que usou o percentual vigente está em dia', () => {
    const r = avaliarProposta({ ...BASE, loaAno: 2026, fatorUsadoId: 'f-out', temProposta: true });
    expect(r.situacao).toBe('em_dia');
  });

  it('percentual mudou depois da proposta → desatualizada', () => {
    // O caso que a frase "eu tenho que atualizar as propostas todos os meses"
    // descreve: a operação ficou parada e o parâmetro andou.
    const r = avaliarProposta({
      fatores: TODOS,
      hojeIso: '2026-11-10',
      loaAno: 2026,
      fatorUsadoId: 'f-out',
      temProposta: true,
    });
    expect(r.situacao).toBe('desatualizada');
    if (r.situacao !== 'desatualizada') throw new Error('tipo');
    expect(r.usado.percentual).toBe(55);
    expect(r.atual.percentual).toBe(65);
    expect(r.variacaoPontos).toBe(10);
  });

  it('a variação é em pontos percentuais e não acumula lixo de float', () => {
    const a: FatorLoa = { ...OUT, id: 'a', percentual: 55.1 };
    const b: FatorLoa = { ...NOV, id: 'b', percentual: 65.3 };
    const r = avaliarProposta({
      fatores: [a, b],
      hojeIso: '2026-11-10',
      loaAno: 2026,
      fatorUsadoId: 'a',
      temProposta: true,
    });
    expect(r.situacao === 'desatualizada' && r.variacaoPontos).toBe(10.2);
  });

  it('variação negativa quando ele baixou o percentual', () => {
    const menor: FatorLoa = { ...NOV, id: 'menor', percentual: 45 };
    const r = avaliarProposta({
      fatores: [OUT, menor],
      hojeIso: '2026-11-10',
      loaAno: 2026,
      fatorUsadoId: 'f-out',
      temProposta: true,
    });
    expect(r.situacao === 'desatualizada' && r.variacaoPontos).toBe(-10);
  });

  it('proposta sem fator vinculado é origem desconhecida, não "em dia"', () => {
    // As 7 operações que já têm preço foram precificadas à mão, antes da
    // tabela existir. Chamar isso de "em dia" afirmaria que elas seguiram um
    // percentual que ninguém aplicou.
    const r = avaliarProposta({ ...BASE, loaAno: 2026, fatorUsadoId: null, temProposta: true });
    expect(r.situacao).toBe('origem_desconhecida');
  });

  it('fator vinculado que não está na lista carregada não vira "em dia"', () => {
    // Defesa contra lista parcial: silenciar isso mostraria um selo verde
    // sobre uma comparação que não aconteceu.
    const r = avaliarProposta({
      ...BASE,
      loaAno: 2026,
      fatorUsadoId: 'f-sumiu',
      temProposta: true,
    });
    expect(r.situacao).toBe('origem_desconhecida');
  });
});

describe('formatação', () => {
  it('vigência em mês abreviado', () => {
    expect(fmtVigencia('2026-10-01')).toBe('out/2026');
    expect(fmtVigencia('2027-01-01')).toBe('jan/2027');
  });

  it('percentual inteiro sem casa decimal', () => {
    expect(fmtPercentual(55)).toBe('55%');
    expect(fmtPercentual(62.5)).toBe('62,5%');
  });
});
