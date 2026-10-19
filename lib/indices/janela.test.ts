import { describe, expect, it } from 'vitest';
import { mesesEntre, planejarJanela, recuarMeses, type ResumoSerieBanco } from './janela';

/**
 * A janela decide quanto da série pedir ao BCB em cada execução.
 *
 * Função pura: nada de rede, nada de banco, e **nada de relógio**. A âncora é a
 * última competência que está NO BANCO, nunca a data de hoje — uma janela
 * ancorada em relógio não cicatriza buraco deixado por um cron parado cinco
 * semanas, e buraco faz `calcularFator` RECUSAR todo precatório com data-base
 * anterior a ele, semanas depois, sem ninguém ligar as duas coisas.
 */

/** Como o banco está hoje: 561 pontos, jan/1980 a set/2026, sem buraco. */
const IPCA_CHEIO: ResumoSerieBanco = {
  total: 561,
  primeiraCompetencia: '1980-01-01',
  ultimaCompetencia: '2026-09-01',
};

describe('recuarMeses', () => {
  it('recua dentro do mesmo ano', () => {
    expect(recuarMeses('2026-09-01', 3)).toBe('2026-06-01');
  });

  it('atravessa a virada do ano', () => {
    expect(recuarMeses('2026-02-01', 3)).toBe('2025-11-01');
    expect(recuarMeses('2026-01-01', 1)).toBe('2025-12-01');
  });

  it('recuar zero devolve a mesma competência', () => {
    expect(recuarMeses('2026-09-01', 0)).toBe('2026-09-01');
  });

  it('recua mais de um ano', () => {
    expect(recuarMeses('2026-03-01', 15)).toBe('2024-12-01');
  });
});

describe('mesesEntre', () => {
  it('conta as duas pontas', () => {
    // jan a mar são 3 meses, não 2.
    expect(mesesEntre('2026-01-01', '2026-03-01')).toBe(3);
    expect(mesesEntre('2026-01-01', '2026-01-01')).toBe(1);
  });

  it('bate com o total real do IPCA no banco', () => {
    // 561 pontos de jan/1980 a set/2026 — é assim que o detector de buraco sabe
    // que a série está completa sem precisar listar as 561 competências.
    expect(mesesEntre('1980-01-01', '2026-09-01')).toBe(561);
  });
});

describe('planejarJanela', () => {
  it('série populada → janela incremental com sobreposição', () => {
    const j = planejarJanela('ipca', IPCA_CHEIO);
    expect(j.motivo).toBe('incremental');
    expect(j.desdeIso).toBe('2026-06-01');
  });

  it('NUNCA pede a partir da competência seguinte à última', () => {
    // O motivo é de construção, não margem de segurança: sondado em 19/10/2026,
    // um intervalo vazio faz o SGS devolver HTTP 404 (séries 188 e 7478) ou
    // HTTP 200 com corpo {"erro":{}} (série 433). Os dois viram BcbError e
    // derrubam a série. Nos dias 1 a 11 de cada mês, "última + 1" é exatamente
    // um intervalo vazio pro IPCA, INPC e IPCA-15.
    const j = planejarJanela('ipca', IPCA_CHEIO);
    expect(j.desdeIso < '2026-09-01').toBe(true);
  });

  it('série vazia → bootstrap, desde o início do catálogo', () => {
    const j = planejarJanela('ipca', undefined);
    expect(j.motivo).toBe('bootstrap');
    expect(j.desdeIso).toBe('1980-01-01');
  });

  it('série com zero pontos → bootstrap', () => {
    const j = planejarJanela('tr', {
      total: 0,
      primeiraCompetencia: null,
      ultimaCompetencia: null,
    });
    expect(j.motivo).toBe('bootstrap');
    expect(j.desdeIso).toBe('1991-03-01');
  });

  it('série com buraco → janela completa, pra cicatrizar', () => {
    // 560 onde deveriam ser 561: falta um mês no meio. A janela incremental
    // nunca alcançaria esse buraco, e ele bloqueia o cálculo de qualquer
    // crédito cuja data-base seja anterior a ele.
    const j = planejarJanela('ipca', { ...IPCA_CHEIO, total: 560 });
    expect(j.motivo).toBe('buraco');
    expect(j.desdeIso).toBe('1980-01-01');
  });

  it('respeita o piso do início da série', () => {
    // Sondado em 19/10/2026: pedir a poupança (série 196) de 01/01/1990, antes
    // do início real dela, devolve HTTP 404. Recuar 3 meses de jul/2012 cairia
    // em abr/2012, que não existe na fonte.
    const j = planejarJanela('poupanca', {
      total: 2,
      primeiraCompetencia: '2012-06-01',
      ultimaCompetencia: '2012-07-01',
    });
    expect(j.desdeIso).toBe('2012-06-01');
    expect(j.motivo).toBe('incremental');
  });

  it('aceita sobreposição configurável', () => {
    expect(planejarJanela('ipca', IPCA_CHEIO, 1).desdeIso).toBe('2026-08-01');
    expect(planejarJanela('ipca', IPCA_CHEIO, 6).desdeIso).toBe('2026-03-01');
  });

  it('recusa sobreposição zero em vez de produzir intervalo vazio', () => {
    // Sobreposição 0 é o bug que a janela existe pra evitar. Falhar alto aqui é
    // melhor que devolver uma janela que derruba a série todo dia 1 a 11.
    expect(() => planejarJanela('ipca', IPCA_CHEIO, 0)).toThrow();
  });

  it('a explicação nomeia o motivo, pra aparecer no log', () => {
    // O cron roda sem ninguém olhando; quando alguém for depurar às 3h da
    // manhã, o log tem que dizer por que a janela era aquela.
    const j = planejarJanela('ipca', IPCA_CHEIO);
    expect(j.explicacao).toContain('set/2026');
    expect(planejarJanela('ipca', undefined).explicacao).toMatch(/vazia|bootstrap/i);
  });
});
