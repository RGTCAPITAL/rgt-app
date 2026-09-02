export type Esfera = 'federal' | 'estadual' | 'municipal';

/**
 * Lista consolidada de tribunais brasileiros por esfera.
 *
 * TODO (issue futura): migrar pra tabela `tribunais` no banco quando
 * (a) admin precisar cadastrar tribunal novo sem passar por deploy, ou
 * (b) precisarmos de metadata extra (esfera, UF, competência).
 * Por enquanto, constante hardcoded resolve — lista muda pouco.
 */
export const TRIBUNAIS_POR_ESFERA: Record<Esfera, readonly string[]> = {
  federal: [
    // Superiores
    'STF - Supremo Tribunal Federal',
    'STJ - Superior Tribunal de Justiça',
    'TST - Tribunal Superior do Trabalho',
    'TSE - Tribunal Superior Eleitoral',
    'STM - Superior Tribunal Militar',

    // TRFs (justiça federal comum, por região)
    'TRF1 - Tribunal Regional Federal 1ª Região (DF, GO, MT, MG, TO, AC, AM, AP, BA, MA, PA, PI, RO, RR)',
    'TRF2 - Tribunal Regional Federal 2ª Região (RJ, ES)',
    'TRF3 - Tribunal Regional Federal 3ª Região (SP, MS)',
    'TRF4 - Tribunal Regional Federal 4ª Região (RS, PR, SC)',
    'TRF5 - Tribunal Regional Federal 5ª Região (AL, CE, PB, PE, RN, SE)',
    'TRF6 - Tribunal Regional Federal 6ª Região (MG)',

    // TRTs (justiça do trabalho, 24 regiões)
    'TRT1 - Tribunal Regional do Trabalho 1ª Região (RJ)',
    'TRT2 - Tribunal Regional do Trabalho 2ª Região (SP capital + baixada)',
    'TRT3 - Tribunal Regional do Trabalho 3ª Região (MG)',
    'TRT4 - Tribunal Regional do Trabalho 4ª Região (RS)',
    'TRT5 - Tribunal Regional do Trabalho 5ª Região (BA)',
    'TRT6 - Tribunal Regional do Trabalho 6ª Região (PE)',
    'TRT7 - Tribunal Regional do Trabalho 7ª Região (CE)',
    'TRT8 - Tribunal Regional do Trabalho 8ª Região (PA, AP)',
    'TRT9 - Tribunal Regional do Trabalho 9ª Região (PR)',
    'TRT10 - Tribunal Regional do Trabalho 10ª Região (DF, TO)',
    'TRT11 - Tribunal Regional do Trabalho 11ª Região (AM, RR)',
    'TRT12 - Tribunal Regional do Trabalho 12ª Região (SC)',
    'TRT13 - Tribunal Regional do Trabalho 13ª Região (PB)',
    'TRT14 - Tribunal Regional do Trabalho 14ª Região (RO, AC)',
    'TRT15 - Tribunal Regional do Trabalho 15ª Região (SP interior)',
    'TRT16 - Tribunal Regional do Trabalho 16ª Região (MA)',
    'TRT17 - Tribunal Regional do Trabalho 17ª Região (ES)',
    'TRT18 - Tribunal Regional do Trabalho 18ª Região (GO)',
    'TRT19 - Tribunal Regional do Trabalho 19ª Região (AL)',
    'TRT20 - Tribunal Regional do Trabalho 20ª Região (SE)',
    'TRT21 - Tribunal Regional do Trabalho 21ª Região (RN)',
    'TRT22 - Tribunal Regional do Trabalho 22ª Região (PI)',
    'TRT23 - Tribunal Regional do Trabalho 23ª Região (MT)',
    'TRT24 - Tribunal Regional do Trabalho 24ª Região (MS)',
  ],
  estadual: [
    'TJAC - Tribunal de Justiça do Acre',
    'TJAL - Tribunal de Justiça de Alagoas',
    'TJAP - Tribunal de Justiça do Amapá',
    'TJAM - Tribunal de Justiça do Amazonas',
    'TJBA - Tribunal de Justiça da Bahia',
    'TJCE - Tribunal de Justiça do Ceará',
    'TJDFT - Tribunal de Justiça do Distrito Federal e Territórios',
    'TJES - Tribunal de Justiça do Espírito Santo',
    'TJGO - Tribunal de Justiça de Goiás',
    'TJMA - Tribunal de Justiça do Maranhão',
    'TJMT - Tribunal de Justiça de Mato Grosso',
    'TJMS - Tribunal de Justiça de Mato Grosso do Sul',
    'TJMG - Tribunal de Justiça de Minas Gerais',
    'TJPA - Tribunal de Justiça do Pará',
    'TJPB - Tribunal de Justiça da Paraíba',
    'TJPR - Tribunal de Justiça do Paraná',
    'TJPE - Tribunal de Justiça de Pernambuco',
    'TJPI - Tribunal de Justiça do Piauí',
    'TJRJ - Tribunal de Justiça do Rio de Janeiro',
    'TJRN - Tribunal de Justiça do Rio Grande do Norte',
    'TJRS - Tribunal de Justiça do Rio Grande do Sul',
    'TJRO - Tribunal de Justiça de Rondônia',
    'TJRR - Tribunal de Justiça de Roraima',
    'TJSC - Tribunal de Justiça de Santa Catarina',
    'TJSP - Tribunal de Justiça de São Paulo',
    'TJSE - Tribunal de Justiça de Sergipe',
    'TJTO - Tribunal de Justiça do Tocantins',
  ],
  municipal: [],
} as const;
