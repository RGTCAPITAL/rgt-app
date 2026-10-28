import { describe, expect, it } from 'vitest';
import { montarTextoModelo, MODELOS, telefoneParaEnvio, variaveisDoModelo } from './modelos';

describe('variaveisDoModelo', () => {
  it('usa o primeiro nome do broker e o processo com máscara', () => {
    expect(
      variaveisDoModelo({
        nomeDestinatario: '  Maria Antonia dos Santos ',
        nomeBroker: 'Robson Ferreira Lima',
        numeroProcesso: '00012345620235190001',
      }),
    ).toEqual(['Maria Antonia dos Santos', 'Robson', '0001234-56.2023.5.19.0001']);
  });

  it('aceita o processo já com máscara', () => {
    expect(
      variaveisDoModelo({
        nomeDestinatario: 'Ana',
        nomeBroker: 'Mateo',
        numeroProcesso: '0001234-56.2023.5.19.0001',
      })[2],
    ).toBe('0001234-56.2023.5.19.0001');
  });
});

describe('montarTextoModelo', () => {
  it('troca as três variáveis e não sobra chave', () => {
    const t = montarTextoModelo('credor', ['Ana', 'Robson', '0001234-56.2023.5.19.0001']);
    expect(t).toContain('Olá, Ana. Aqui é Robson, da RGT Capital');
    expect(t).toContain('o processo 0001234-56.2023.5.19.0001 teve');
    expect(t).not.toMatch(/\{\{/);
  });

  it('advogado recebe o modelo próprio', () => {
    expect(montarTextoModelo('advogado', ['Carla Menezes', 'Mateo', 'x'])).toMatch(
      /^Olá, Dr\(a\)\. Carla Menezes\./,
    );
  });

  it('só o credor tem robô na resposta', () => {
    expect(MODELOS.credor.robo).toBe(true);
    expect(MODELOS.advogado.robo).toBe(false);
  });
});

describe('telefoneParaEnvio', () => {
  it.each([
    ['82999530897', '5582999530897'],
    ['(82) 99953-0897', '5582999530897'],
    ['+55 82 99953-0897', '5582999530897'],
    ['5582999530897', '5582999530897'],
  ])('%s → %s', (entrada, saida) => {
    expect(telefoneParaEnvio(entrada)).toBe(saida);
  });

  it.each<[string | null, string]>([
    ['8233334444', 'fixo ou celular sem o 9'],
    ['08299953089', 'DDD com zero'],
    ['999530897', 'sem DDD'],
    ['', 'vazio'],
    [null, 'nulo'],
  ])('recusa %s (%s)', (entrada) => {
    expect(telefoneParaEnvio(entrada)).toBeNull();
  });
});
