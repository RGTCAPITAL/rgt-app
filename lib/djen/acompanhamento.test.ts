import { describe, expect, it } from 'vitest';
import { resumirNovidades } from './acompanhamento';
import type { Publicacao, RedFlag } from './types';

function pub(data: string, codigos: string[] = [], tipoDocumento = 'Despacho'): Publicacao {
  return {
    dataDisponibilizacao: data,
    tipoDocumento,
    tipoComunicacao: 'Intimação',
    redFlags: codigos.map((codigo) => ({ codigo }) as RedFlag),
  } as Publicacao;
}

describe('resumirNovidades', () => {
  it('cessão vira urgente, com o aviso em português no topo', () => {
    const r = resumirNovidades('José', [pub('2026-10-27', ['X1', '1'])]);
    expect(r.urgente).toBe(true);
    expect(r.titulo).toBe('ATENÇÃO: o processo de José teve publicação grave');
    expect(r.descricao).toContain('Alguém já comprou este crédito');
    expect(r.descricao).toContain('(+1 sinal)');
  });

  it('pagamento também é urgente', () => {
    expect(resumirNovidades('Ana', [pub('2026-10-27', ['4'])]).urgente).toBe(true);
  });

  it('ofício expedido é notícia, não urgência', () => {
    const r = resumirNovidades('Ana', [pub('2026-10-27', ['X1'])]);
    expect(r.urgente).toBe(false);
    expect(r.titulo).toBe('Processo andou: Ana');
  });

  it('conta as publicações e mostra a data mais recente', () => {
    const r = resumirNovidades('Ana', [pub('2026-10-20'), pub('2026-10-27'), pub('2026-10-22')]);
    expect(r.descricao).toMatch(/^3 publicações novas no Diário \(27\/10\/2026\)\./);
  });

  it('sem sinal conhecido, diz o tipo de documento', () => {
    const r = resumirNovidades('Ana', [pub('2026-10-27', [], 'Sentença')]);
    expect(r.descricao).toBe('1 publicação nova no Diário (27/10/2026). Sentença');
  });

  it('ignora o boilerplate X7, que sai em toda expedição', () => {
    const r = resumirNovidades('Ana', [pub('2026-10-27', ['X7'], 'Ofício')]);
    expect(r.urgente).toBe(false);
    expect(r.descricao).toContain('Ofício');
    expect(r.descricao).not.toContain('+');
  });
});
