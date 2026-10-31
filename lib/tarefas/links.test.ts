import { describe, expect, it } from 'vitest';
import { separarLinks } from './links';

describe('separarLinks', () => {
  it('tira as linhas de publicação do texto e devolve como links', () => {
    const r = separarLinks(
      'Processo 0000001-11.2023.5.19.0001.\nPublicação de 27/10/2026: https://exemplo.jus.br/a/1\nLeia a publicação.',
    );
    expect(r.texto).toBe('Processo 0000001-11.2023.5.19.0001.\nLeia a publicação.');
    expect(r.links).toEqual([
      { rotulo: 'Abrir publicação de 27/10/2026', url: 'https://exemplo.jus.br/a/1' },
    ]);
  });

  it('descrição sem link fica igual', () => {
    expect(separarLinks('Ligar pro credor')).toEqual({ texto: 'Ligar pro credor', links: [] });
  });

  it('vazio e null', () => {
    expect(separarLinks(null)).toEqual({ texto: null, links: [] });
    expect(separarLinks('')).toEqual({ texto: '', links: [] });
  });

  it('não pega URL solta no meio de uma frase', () => {
    expect(separarLinks('veja https://exemplo.jus.br').links).toEqual([]);
  });
});
