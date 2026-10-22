import { describe, expect, it } from 'vitest';
import { buscarPorNome } from './busca-por-nome';
import type { Publicacao, RedFlag } from './types';
import type { DjenItem } from './types.raw';

/**
 * Fixtures espelham a varredura real da RGT-95 (2026-10-22): o Renato mandou
 * três nomes por WhatsApp, e o resultado mostrou que o nome sozinho não separa
 * prospect de ruído. Os CNJs e as partes abaixo são os de verdade.
 *
 * O iterador é injetado pra não bater na API do CNJ: o comportamento de rede
 * já tem cobertura em client.integration.test.ts.
 */

let seq = 0;

function pub(over: {
  cnj: string;
  tribunal: string;
  data: string;
  orgao: string;
  partes: Array<[string, 'A' | 'P' | 'T']>;
  redFlags?: RedFlag[];
}): Publicacao {
  seq += 1;
  return {
    id: seq,
    hash: `h${seq}`,
    dataDisponibilizacao: over.data,
    siglaTribunal: over.tribunal,
    orgao: { id: seq, nome: over.orgao },
    processo: { cnj: over.cnj, cnjMascarado: over.cnj },
    tipoComunicacao: 'Intimação',
    tipoDocumento: 'Despacho',
    classe: { codigo: '1', nome: 'Procedimento Comum' },
    meio: 'D',
    link: null,
    texto: '',
    ativo: true,
    status: 'ativo',
    cancelamento: null,
    destinatarios: over.partes.map(([nome, polo]) => ({ nome, polo, mascarado: false })),
    advogados: [],
    redFlags: over.redFlags ?? [],
    extracao: {},
    _raw: {} as DjenItem,
  };
}

function iteradorDe(pubs: Publicacao[]) {
  return async function* (params: { siglaTribunal?: string }) {
    for (const p of pubs) {
      if (!params.siglaTribunal || p.siglaTribunal === params.siglaTribunal) yield p;
    }
  };
}

const flag = (codigo: string): RedFlag => ({
  codigo,
  categoria: 'estado' as RedFlag['categoria'],
  cor: 'amarelo',
  precisao: 0.9,
  trecho: '',
  contexto: '',
});

describe('buscarPorNome — agrupamento', () => {
  it('agrupa publicações do mesmo processo numa linha só', () => {
    // No TRT19 a Maria Antonia tinha 66 publicações em 9 processos. Entregar
    // 66 linhas pro broker é o bug que esta função existe pra evitar.
    const pubs = [
      pub({
        cnj: '00001425720265190060',
        tribunal: 'TRT19',
        data: '2026-03-30',
        orgao: 'VT União dos Palmares',
        partes: [
          ['MARIA ANTONIA DOS SANTOS', 'A'],
          ['RESTAURANTE CASA DA PRAIA LTDA', 'P'],
        ],
      }),
      pub({
        cnj: '00001425720265190060',
        tribunal: 'TRT19',
        data: '2026-05-08',
        orgao: 'VT União dos Palmares',
        partes: [
          ['MARIA ANTONIA DOS SANTOS', 'A'],
          ['RESTAURANTE CASA DA PRAIA LTDA', 'P'],
        ],
      }),
    ];

    return buscarPorNome('Maria Antonia dos Santos', {
      tribunais: ['TRT19'],
      iterador: iteradorDe(pubs),
    }).then((r) => {
      expect(r.processos).toHaveLength(1);
      expect(r.processos[0].publicacoes).toBe(2);
      expect(r.processos[0].primeiraPublicacao).toBe('2026-03-30');
      expect(r.processos[0].ultimaPublicacao).toBe('2026-05-08');
      expect(r.totalPublicacoes).toBe(2);
    });
  });

  it('registra como o nome aparece nos autos, que diverge do buscado', async () => {
    const r = await buscarPorNome('Maria Sofia de Oliveira', {
      tribunais: ['TRT19'],
      iterador: iteradorDe([
        pub({
          cnj: '00000981520265190003',
          tribunal: 'TRT19',
          data: '2026-03-25',
          orgao: '3ª VT de Maceió',
          partes: [
            ['MARIA SOFIA DE OLIVEIRA SANTOS', 'A'],
            ['UNIÃO FEDERAL (AGU)', 'P'],
          ],
        }),
      ]),
    });
    expect(r.processos[0].nosAutos).toEqual(['MARIA SOFIA DE OLIVEIRA SANTOS']);
  });
});

describe('buscarPorNome — triagem pelo devedor', () => {
  it('põe o devedor público na frente do privado', async () => {
    // O caso Waldiria: no TRT19 ela tinha processo contra o Estado, mas o que
    // interessa de verdade só aparece quando se varre o TJAL também.
    const r = await buscarPorNome('Waldiria', {
      tribunais: ['TRT19', 'TJAL'],
      iterador: iteradorDe([
        pub({
          cnj: '00728032032024802001',
          tribunal: 'TJAL',
          data: '2024-11-01',
          orgao: 'Vara Cível',
          partes: [
            ['WALDIRIA MARIA SIQUEIRA AYRES', 'A'],
            ['BANCO BMG S/A', 'P'],
          ],
        }),
        pub({
          cnj: '07077053720248020001',
          tribunal: 'TJAL',
          data: '2026-05-14',
          orgao: '3ª Câmara Cível',
          partes: [
            ['WALDIRIA MARIA SIQUEIRA AYRES', 'A'],
            ['ESTADO DE ALAGOAS', 'P'],
          ],
        }),
      ]),
    });

    expect(r.processos[0].cnj).toBe('07077053720248020001');
    expect(r.processos[0].classe).toBe('estadual');
    expect(r.processos[0].comprado).toBe(true);
    expect(r.processos[1].comprado).toBe(false);
    expect(r.comprados).toBe(1);
  });

  it('avisa quando nenhum processo tem devedor público', async () => {
    // Foi o que aconteceu com os 9 processos da Maria Antonia no TRT19.
    const r = await buscarPorNome('Maria Antonia dos Santos', {
      tribunais: ['TRT19'],
      iterador: iteradorDe([
        pub({
          cnj: '00001425720265190060',
          tribunal: 'TRT19',
          data: '2026-05-08',
          orgao: 'VT União dos Palmares',
          partes: [
            ['MARIA ANTONIA DOS SANTOS', 'A'],
            ['RESTAURANTE CASA DA PRAIA LTDA', 'P'],
          ],
        }),
      ]),
    });
    expect(r.comprados).toBe(0);
    expect(r.avisos.join(' ')).toMatch(/nenhum dos 1 processos tem devedor público/i);
  });

  it('a vara chamada "União dos Palmares" não transforma o processo em federal', async () => {
    // O nome do órgão não entra na classificação — só as partes. Se entrasse,
    // todo processo dessa vara viraria prospect falso.
    const r = await buscarPorNome('Maria Antonia dos Santos', {
      tribunais: ['TRT19'],
      iterador: iteradorDe([
        pub({
          cnj: '00001425720265190060',
          tribunal: 'TRT19',
          data: '2026-05-08',
          orgao: 'Vara do Trabalho de União dos Palmares',
          partes: [
            ['MARIA ANTONIA DOS SANTOS', 'A'],
            ['RESTAURANTE CASA DA PRAIA LTDA', 'P'],
          ],
        }),
      ]),
    });
    expect(r.processos[0].classe).toBe('privado');
  });
});

describe('buscarPorNome — avisos que evitam conclusão errada', () => {
  it('busca vazia sugere tentar pedaço do nome', async () => {
    // "Waldiria Maria S Aires" devolve zero; "Waldiria" acha na hora.
    const r = await buscarPorNome('Waldiria Maria S Aires', {
      tribunais: ['TRT19'],
      iterador: iteradorDe([]),
    });
    expect(r.processos).toHaveLength(0);
    expect(r.avisos.join(' ')).toMatch(/casa o nome literalmente/i);
  });

  it('alerta homônimo quando as partes contrárias divergem', async () => {
    const r = await buscarPorNome('Maria Antonia dos Santos', {
      tribunais: ['TRT19'],
      iterador: iteradorDe([
        pub({
          cnj: '00001425720265190060',
          tribunal: 'TRT19',
          data: '2026-05-08',
          orgao: 'VT A',
          partes: [
            ['MARIA ANTONIA DOS SANTOS', 'A'],
            ['RESTAURANTE CASA DA PRAIA LTDA', 'P'],
          ],
        }),
        pub({
          cnj: '00003771120255190011',
          tribunal: 'TRT19',
          data: '2025-12-03',
          orgao: 'VT B',
          partes: [
            ['MARIA ANTONIA DOS SANTOS', 'A'],
            ['CARINA ISABEL LISA', 'P'],
          ],
        }),
      ]),
    });
    expect(r.avisos.join(' ')).toMatch(/provavelmente mais de uma pessoa/i);
  });

  it('um tribunal fora do ar não derruba a busca inteira', async () => {
    const quebrado = async function* (params: { siglaTribunal?: string }) {
      if (params.siglaTribunal === 'TJAL') throw new Error('502 Bad Gateway');
      yield pub({
        cnj: '00000981520265190003',
        tribunal: 'TRT19',
        data: '2026-03-25',
        orgao: '3ª VT',
        partes: [
          ['MARIA SOFIA DE OLIVEIRA SANTOS', 'A'],
          ['UNIÃO FEDERAL (AGU)', 'P'],
        ],
      });
    };
    const r = await buscarPorNome('Maria Sofia', {
      tribunais: ['TRT19', 'TJAL'],
      iterador: quebrado,
    });
    expect(r.processos).toHaveLength(1);
    expect(r.avisos.join(' ')).toMatch(/TJAL: falhou/);
  });

  it('nome curto demais não dispara varredura', async () => {
    let chamou = false;
    const espiao = async function* () {
      chamou = true;
    };
    const r = await buscarPorNome('Ma', { iterador: espiao });
    expect(chamou).toBe(false);
    expect(r.avisos[0]).toMatch(/3 caracteres/);
  });
});

describe('buscarPorNome — sinais de fase', () => {
  it('traduz red flag de fase em texto legível e deduplica entre publicações', async () => {
    const r = await buscarPorNome('Fulano de Tal', {
      tribunais: ['TJAL'],
      iterador: iteradorDe([
        pub({
          cnj: '07077053720248020001',
          tribunal: 'TJAL',
          data: '2026-01-01',
          orgao: 'Vara',
          partes: [
            ['FULANO DE TAL', 'A'],
            ['ESTADO DE ALAGOAS', 'P'],
          ],
          redFlags: [flag('9'), flag('X1')],
        }),
        pub({
          cnj: '07077053720248020001',
          tribunal: 'TJAL',
          data: '2026-02-01',
          orgao: 'Vara',
          partes: [
            ['FULANO DE TAL', 'A'],
            ['ESTADO DE ALAGOAS', 'P'],
          ],
          redFlags: [flag('X1'), flag('2')],
        }),
      ]),
    });

    expect(r.processos[0].fase).toContain('trânsito em julgado');
    expect(r.processos[0].fase).toContain('ofício requisitório / precatório');
    // '2' é FIDC/securitizadora — red flag de risco, não sinal de fase.
    expect(r.processos[0].fase).toHaveLength(2);
    // Mas continua disponível na lista crua pro broker.
    expect(r.processos[0].redFlags.map((f) => f.codigo)).toContain('2');
  });
});
