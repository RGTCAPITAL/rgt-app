import { describe, expect, it } from 'vitest';
import { LIMITE_ATRASO_MESES } from '@/lib/precificacao/limites';
import { avaliarFrescor, diasDesde, fmtCompetencia } from './frescor';

/**
 * O selo tem uma obrigação: avisar ANTES de a precificação travar.
 *
 * Se ele dissesse "em dia" no mesmo dia em que `obterFatorCorrecao` começa a
 * recusar, seria pior que não existir — alguém olharia o painel verde e iria
 * procurar o problema em outro lugar. Daí o teste que amarra os dois.
 */

/** Estado real do banco em 19/10/2026. */
const ULTIMA = '2026-09-01';
const COLETADO = '2026-10-13T20:38:47.772+00:00';

describe('diasDesde', () => {
  it('conta dias de calendário, não horas decorridas', () => {
    // Coletado no dia 13, hoje é dia 19: são 6 dias no calendário. Contar horas
    // daria 5, porque a coleta foi às 20h38 — e "há 5 dias" para quem olha o
    // calendário está simplesmente errado.
    expect(diasDesde(COLETADO, '2026-10-19')).toBe(6);
    expect(diasDesde('2026-10-19T01:00:00Z', '2026-10-19')).toBe(0);
  });

  it('não devolve negativo quando a coleta é posterior', () => {
    // Pode acontecer com fuso ou relógio dessincronizado. "há -1 dias" é pior
    // que "hoje".
    expect(diasDesde('2026-10-20T10:00:00Z', '2026-10-19')).toBe(0);
  });
});

describe('fmtCompetencia', () => {
  it('abrevia o mês em português', () => {
    expect(fmtCompetencia('2026-09-01')).toBe('set/2026');
    expect(fmtCompetencia('2026-01-01')).toBe('jan/2026');
    expect(fmtCompetencia('2026-12-01')).toBe('dez/2026');
  });
});

describe('avaliarFrescor', () => {
  it('estado real de hoje: em dia, com a data de travamento à vista', () => {
    const f = avaliarFrescor(ULTIMA, COLETADO, '2026-10-19');
    expect(f.nivel).toBe('ok');
    expect(f.atrasoMeses).toBe(1);
    expect(f.travaEm).toBe('2026-12-01');
    expect(f.rotulo).toBe('há 6 dias');
    expect(f.detalhe).toContain('dez/2026');
  });

  it('avisa no mês ANTERIOR ao travamento, não depois', () => {
    // Novembro: atraso de 2, que é o limite — ainda passa, mas é o último mês.
    const f = avaliarFrescor(ULTIMA, COLETADO, '2026-11-20');
    expect(f.atrasoMeses).toBe(LIMITE_ATRASO_MESES);
    expect(f.nivel).toBe('atencao');
    expect(f.detalhe).toContain('dez/2026');
  });

  it('em dezembro já está travado', () => {
    // Atraso de 3 > limite de 2. É o prazo concreto que o cron existe pra
    // evitar: sem sincronização, a precificação para aqui.
    const f = avaliarFrescor(ULTIMA, COLETADO, '2026-12-05');
    expect(f.nivel).toBe('travado');
    expect(f.atrasoMeses).toBe(3);
    expect(f.detalhe).toMatch(/JÁ recusa/);
  });

  it('o nível nunca discorda do que a precificação faz', () => {
    // A amarração que justifica o arquivo. Varre 10 meses e confere que
    // 'travado' acontece exatamente quando atraso > LIMITE, que é a condição
    // literal de obterFatorCorrecao.
    for (let m = 0; m < 10; m++) {
      const hoje = `2026-${String(9 + m).padStart(2, '0')}-15`;
      // Só os meses de 2026 (set a dez); o resto rola pra 2027 e a aritmética
      // de string não serve.
      if (9 + m > 12) break;
      const f = avaliarFrescor(ULTIMA, COLETADO, hoje);
      expect(f.nivel === 'travado').toBe(f.atrasoMeses > LIMITE_ATRASO_MESES);
    }
  });

  it('série nunca coletada é estado próprio, não "muito atrasada"', () => {
    // Zero não é o mesmo que vazio. A tabela precisa distinguir pra não dizer
    // "em dia" numa série que não tem um único ponto.
    const f = avaliarFrescor(null, null, '2026-10-19');
    expect(f.nivel).toBe('vazia');
    expect(f.travaEm).toBeNull();
    expect(f.rotulo).toBe('nunca coletada');
  });

  it('série com dados mas sem data de coleta cai no rótulo da competência', () => {
    const f = avaliarFrescor(ULTIMA, null, '2026-10-19');
    expect(f.nivel).toBe('ok');
    expect(f.rotulo).toBe('set/2026');
  });

  it('coletado hoje e ontem têm rótulo próprio', () => {
    expect(avaliarFrescor(ULTIMA, '2026-10-19T10:00:00Z', '2026-10-19').rotulo).toBe('hoje');
    expect(avaliarFrescor(ULTIMA, '2026-10-18T10:00:00Z', '2026-10-19').rotulo).toBe('ontem');
  });

  it('coleta recente não disfarça série velha', () => {
    // O caso que o selo de "coletado há N dias" sozinho esconderia: o cron roda
    // todo dia, a coleta está fresquíssima, e a FONTE é que parou de publicar.
    // O nível tem que olhar a competência, não a data da coleta.
    const f = avaliarFrescor('2026-05-01', '2026-10-19T10:00:00Z', '2026-10-19');
    expect(f.rotulo).toBe('hoje');
    expect(f.nivel).toBe('travado');
  });
});
