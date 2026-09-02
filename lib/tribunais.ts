export type Esfera = 'federal' | 'estadual' | 'municipal';

export const TRIBUNAIS_POR_ESFERA: Record<Esfera, readonly string[]> = {
  federal: [
    'STF - Supremo Tribunal Federal',
    'STJ - Superior Tribunal de Justiça',
    'TST - Tribunal Superior do Trabalho',
    'TRF1 - Tribunal Regional Federal 1ª Região',
    'TRF2 - Tribunal Regional Federal 2ª Região',
    'TRF3 - Tribunal Regional Federal 3ª Região',
    'TRF4 - Tribunal Regional Federal 4ª Região',
    'TRF5 - Tribunal Regional Federal 5ª Região',
    'TRF6 - Tribunal Regional Federal 6ª Região',
    'TRT6 - Tribunal Regional do Trabalho 6ª Região (PE)',
    'TRT19 - Tribunal Regional do Trabalho 19ª Região (AL)',
  ],
  estadual: [
    'TJAL - Tribunal de Justiça de Alagoas',
    'TJPE - Tribunal de Justiça de Pernambuco',
    'TJSE - Tribunal de Justiça de Sergipe',
    'TJPB - Tribunal de Justiça da Paraíba',
    'TJRN - Tribunal de Justiça do Rio Grande do Norte',
    'TJCE - Tribunal de Justiça do Ceará',
    'TJBA - Tribunal de Justiça da Bahia',
    'TJSP - Tribunal de Justiça de São Paulo',
    'TJRJ - Tribunal de Justiça do Rio de Janeiro',
  ],
  municipal: [],
} as const;
