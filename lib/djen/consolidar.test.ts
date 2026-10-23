import { describe, expect, it } from 'vitest';
import {
  codigosDedup,
  consolidarProcesso,
  escolherAdvogado,
  escolherCredor,
  motivoNaoCredor,
  peritosCitados,
} from './consolidar';
import { mapCruParaPublicacao } from './mappers';
import type { Publicacao, RedFlag } from './types';
import type { DjenItem, Polo } from './types.raw';

/*
 * Fixtures com nomes FICTÍCIOS (o repo é público), copiando o formato dos
 * textos reais do TRT19 levantados em 23/10: cabeçalho do PJe com dois
 * espaços entre campos, destinatários em ordem alfabética, ente no polo A
 * quando recorre, perito como polo A.
 */

const CNJ = '00009991120235190004';
const CNJ_MASC = '0000999-11.2023.5.19.0004';
const VARA =
  'PODER JUDICIÁRIO  JUSTIÇA DO TRABALHO  TRIBUNAL REGIONAL DO TRABALHO DA 19ª REGIÃO  4ª VARA DO TRABALHO DE MACEIÓ';

interface AdvFixture {
  id: number;
  nome: string;
  oab: string;
  uf?: string;
}

let seq = 900_000_000;

function pub(opts: {
  texto: string;
  data?: string;
  destinatarios?: Array<[string, Polo]>;
  advogados?: AdvFixture[];
  cancelada?: boolean;
}): Publicacao {
  const id = ++seq;
  const data = opts.data ?? '2025-06-10';
  const item: DjenItem = {
    id,
    hash: `hash${id}`,
    data_disponibilizacao: data,
    datadisponibilizacao: data.split('-').reverse().join('/'),
    siglaTribunal: 'TRT19',
    tipoComunicacao: 'Intimação',
    nomeOrgao: '4ª Vara do Trabalho de Maceió',
    idOrgao: 1,
    texto: opts.texto,
    numero_processo: CNJ,
    numeroprocessocommascara: CNJ_MASC,
    meio: 'D',
    meiocompleto: 'Diário de Justiça Eletrônico Nacional',
    link: null,
    tipoDocumento: 'Notificação',
    nomeClasse: 'CUMPRIMENTO DE SENTENÇA',
    codigoClasse: '156',
    numeroComunicacao: 1,
    ativo: true,
    status: 'P',
    motivo_cancelamento: opts.cancelada ? 'Publicada por engano' : null,
    data_cancelamento: opts.cancelada ? data : null,
    destinatarios: (opts.destinatarios ?? []).map(([nome, polo]) => ({
      comunicacao_id: id,
      nome,
      polo,
    })),
    destinatarioadvogados: (opts.advogados ?? []).map((a, i) => ({
      id: id * 10 + i,
      comunicacao_id: id,
      advogado_id: a.id,
      created_at: `${data}T10:00:00`,
      updated_at: `${data}T10:00:00`,
      advogado: { id: a.id, nome: a.nome, numero_oab: a.oab, uf_oab: a.uf ?? 'AL' },
    })),
  };
  return mapCruParaPublicacao(item);
}

const ESTADO = 'ESTADO DE ALAGOAS';
const ESTATAL = 'COMPANHIA ESTADUAL DE SERVICOS GERAIS';
const NOTIFICACAO_SIMPLES = 'Tomar ciência do(a) Intimação de ID 1a2b3c4.';

// ---------------------------------------------------------------------------

describe('motivoNaoCredor', () => {
  it('ente público: Estado, União, INSS e Caixa', () => {
    expect(motivoNaoCredor(ESTADO)).toBe('ente público');
    expect(motivoNaoCredor('UNIÃO FEDERAL (AGU)')).toBe('ente público');
    expect(motivoNaoCredor('INSTITUTO NACIONAL DO SEGURO SOCIAL - INSS')).toBe('ente público');
    expect(motivoNaoCredor('CAIXA ECONOMICA FEDERAL')).toBe('ente público');
  });

  it('empresa, escritório ou sindicato', () => {
    expect(motivoNaoCredor('BRITO SA E CAMPOS SOCIEDADE DE ADVOGADOS')).toBe(
      'empresa, escritório ou sindicato',
    );
    expect(motivoNaoCredor('VIGILANCIA BOA ESPERANCA LTDA - ME')).toBe(
      'empresa, escritório ou sindicato',
    );
    expect(motivoNaoCredor('SERVICOS TECNICOS DO NORDESTE S/A')).toBe(
      'empresa, escritório ou sindicato',
    );
    expect(motivoNaoCredor('ALFA PRECATÓRIOS FIDC')).toBe('empresa, escritório ou sindicato');
    expect(motivoNaoCredor('5.ª VARA DO TRABALHO DE MACEIÓ')).toBe(
      'empresa, escritório ou sindicato',
    );
  });

  it('sindicato com "ESTADO DE ..." no nome não vira ente', () => {
    expect(motivoNaoCredor('SINDICATO DOS ENGENHEIROS NO ESTADO DE ALAGOAS')).toBe(
      'empresa, escritório ou sindicato',
    );
  });

  it('Sá é sobrenome, não S.A.', () => {
    expect(motivoNaoCredor('PEDRO DE SÁ LOBO')).toBeNull();
    expect(motivoNaoCredor('PEDRO DE SA LOBO')).toBeNull();
  });

  it('advogado do processo: nome igual ou prefixo', () => {
    const advogados = ['TIAGO LINS BARRETO'];
    expect(motivoNaoCredor('TIAGO LINS BARRETO', { advogados })).toBe('advogado do processo');
    expect(motivoNaoCredor('TIAGO LINS', { advogados })).toBe('advogado do processo');
    expect(motivoNaoCredor('TIAGO LIMA', { advogados })).toBeNull();
  });

  it('perito: compara normalizado (acento e caixa não importam)', () => {
    const peritos = new Set(['Ademir Souto Cavalcânti']);
    expect(motivoNaoCredor('ADEMIR SOUTO CAVALCANTI', { peritos })).toBe('perito');
  });

  it('pessoa física comum passa', () => {
    expect(motivoNaoCredor('LUCIANA MOTA FARIAS')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('peritosCitados', () => {
  it('pega os formatos reais: perito contábil, perita, perito credor com CRC', () => {
    const pubs = [
      pub({
        texto: 'Intime-se o perito contábil ADEMIR SOUTO CAVALCANTI para atualizar os cálculos.',
      }),
      pub({
        texto: 'INTIME-SE a perita GLÓRIA MENDES ARAÚJO para, no prazo de 5 dias, depositar.',
      }),
      pub({
        texto: 'Libere-se em favor do perito credor: OTAVIO RAMOS PIRES - CRC/AL 9999 o valor.',
      }),
    ];
    expect(peritosCitados(pubs)).toEqual(
      new Set(['ADEMIR SOUTO CAVALCANTI', 'GLORIA MENDES ARAUJO', 'OTAVIO RAMOS PIRES']),
    );
  });

  it('ignora "perito" sem nome em maiúscula depois', () => {
    const pubs = [
      pub({
        texto:
          'O Sr. Perito considerou as férias. Remetam-se os autos ao perito do Juízo para retificação.',
      }),
      pub({
        texto:
          'intime-se o perito contábil para atualizar o crédito devido a MARIA DAS DORES LEAL.',
      }),
    ];
    expect(peritosCitados(pubs).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('escolherCredor', () => {
  it('descarta sociedade de advogados que vem antes na ordem alfabética', () => {
    const pubs = [
      pub({
        texto: `${VARA}  ATOrd ${CNJ_MASC}  AUTOR: MARTA DE SOUZA LIMA  RÉU: ${ESTADO} E OUTROS (1)  Destinatário: MARTA DE SOUZA LIMA    NOTIFICAÇÃO PJe-JT`,
        destinatarios: [
          [ESTADO, 'P'],
          ['BRITO SA E CAMPOS SOCIEDADE DE ADVOGADOS', 'A'],
          ['MARTA DE SOUZA LIMA', 'A'],
        ],
      }),
    ];
    const c = escolherCredor(pubs);
    expect(c.nome).toBe('MARTA DE SOUZA LIMA');
    expect(c.fonte).toBe('cabecalho');
    expect(c.outros).toEqual([]);
  });

  it('ente como AGRAVANTE no polo A → a AGRAVADA pessoa física é a credora', () => {
    const pubs = [
      pub({
        texto: `SEGUNDA TURMA  Relatora: FULANA DE TAL  AP ${CNJ_MASC}  AGRAVANTE: ${ESTADO}  AGRAVADA: ROSANA FERREIRA DIAS E OUTROS (1)  PROCESSO nº ${CNJ_MASC} (AP) AGRAVANTE: ${ESTADO} AGRAVADA: ROSANA FERREIRA DIAS, ${ESTATAL} RELATORA: FULANA DE TAL`,
        destinatarios: [
          [ESTATAL, 'P'],
          [ESTADO, 'A'],
          ['ROSANA FERREIRA DIAS', 'P'],
        ],
      }),
    ];
    const c = escolherCredor(pubs);
    expect(c.nome).toBe('ROSANA FERREIRA DIAS');
    expect(c.fonte).toBe('recurso');
    // O "E OUTROS (1)" do recurso é a estatal, não um litisconsorte.
    expect(c.plurima).toBe(false);
  });

  it('aceita rótulo colado na palavra anterior ("ALAGOASAGRAVADOS:")', () => {
    const pubs = [
      pub({
        texto: `PROCESSO nº ${CNJ_MASC} (AP)AGRAVANTE: ESTADO DE ALAGOASAGRAVADOS: ROSANA FERREIRA DIAS, ${ESTATAL}`,
        destinatarios: [[ESTADO, 'A']],
      }),
    ];
    expect(escolherCredor(pubs).nome).toBe('ROSANA FERREIRA DIAS');
  });

  it('perito do conjunto (opts.peritos) não vira credor', () => {
    // Sem cabeçalho nenhum: só o polo decide, e o perito vem antes no alfabeto.
    const pubs = [
      pub({
        texto: NOTIFICACAO_SIMPLES,
        destinatarios: [
          ['ADEMIR SOUTO CAVALCANTI', 'A'],
          [ESTADO, 'P'],
          ['LUCIANA MOTA FARIAS', 'A'],
        ],
      }),
    ];
    const c = escolherCredor(pubs, { peritos: new Set(['ADEMIR SOUTO CAVALCANTI']) });
    expect(c.nome).toBe('LUCIANA MOTA FARIAS');
    expect(c.fonte).toBe('polo');
    expect(c.outros).not.toContain('ADEMIR SOUTO CAVALCANTI');
  });

  it('perito citado no próprio processo não vira credor', () => {
    const pubs = [
      pub({
        data: '2025-06-10',
        texto: NOTIFICACAO_SIMPLES,
        destinatarios: [
          ['ADEMIR SOUTO CAVALCANTI', 'A'],
          [ESTADO, 'P'],
          ['LUCIANA MOTA FARIAS', 'A'],
        ],
      }),
      pub({
        data: '2025-03-02',
        texto:
          'DESPACHO Intime-se o perito contábil ADEMIR SOUTO CAVALCANTI para atualizar os cálculos.',
        destinatarios: [
          ['ADEMIR SOUTO CAVALCANTI', 'A'],
          [ESTADO, 'P'],
          ['LUCIANA MOTA FARIAS', 'A'],
        ],
      }),
    ];
    expect(escolherCredor(pubs).nome).toBe('LUCIANA MOTA FARIAS');
  });

  it('descarta a Caixa no polo A', () => {
    const pubs = [
      pub({
        texto: `${VARA}  ATOrd ${CNJ_MASC}  AUTOR: DENIS ARAGAO PINTO  RÉU: ${ESTATAL} E OUTROS (1)  NOTIFICAÇÃO PJE - JT`,
        destinatarios: [
          ['CAIXA ECONOMICA FEDERAL', 'A'],
          [ESTATAL, 'P'],
          ['DENIS ARAGAO PINTO', 'A'],
        ],
      }),
    ];
    expect(escolherCredor(pubs).nome).toBe('DENIS ARAGAO PINTO');
  });

  it('só ente e empresa no polo A → nome null', () => {
    const pubs = [
      pub({
        texto: NOTIFICACAO_SIMPLES,
        destinatarios: [
          [ESTADO, 'A'],
          ['SERVICOS TECNICOS DO NORDESTE S/A', 'A'],
          ['E.A.D.O.', 'A'],
        ],
      }),
    ];
    expect(escolherCredor(pubs)).toEqual({
      nome: null,
      fonte: null,
      plurima: false,
      espolio: false,
      outros: [],
    });
  });

  it('corta a cauda "ADVOGADO: Dr. ..." e mantém o Sá do sobrenome', () => {
    const pubs = [
      pub({
        texto: `PROCESSO nº ${CNJ_MASC} (AP) AGRAVANTE: ${ESTADO} AGRAVADO: RAIMUNDO DE SÁ MOREIRA ADVOGADO: Dr. Tiago Lins Barreto AGRAVADA: ${ESTATAL}`,
        destinatarios: [[ESTADO, 'A']],
      }),
    ];
    expect(escolherCredor(pubs).nome).toBe('RAIMUNDO DE SÁ MOREIRA');
  });

  it('espólio "NOME (ESPÓLIO DE) E OUTROS (3)" → "NOME (ESPÓLIO)", espólio e plúrima', () => {
    const pubs = [
      pub({
        texto: `${VARA}  CumSen ${CNJ_MASC}  EXEQUENTE: GERALDO BATISTA NEVES (ESPÓLIO DE) E OUTROS (3)  EXECUTADO: ${ESTADO} E OUTROS (1)  INTIMAÇÃO  Fica V. Sa. intimado`,
        destinatarios: [
          [ESTADO, 'P'],
          ['GERALDO BATISTA NEVES', 'A'],
        ],
      }),
    ];
    const c = escolherCredor(pubs);
    expect(c.nome).toBe('GERALDO BATISTA NEVES (ESPÓLIO)');
    expect(c.espolio).toBe(true);
    expect(c.plurima).toBe(true);
    expect(c.fonte).toBe('cabecalho');
  });

  it('espólio com a caixa quebrada do DJEN ("ESPóLIO") não corta o nome', () => {
    const pubs = [
      pub({
        texto: `${VARA}  CumSen ${CNJ_MASC}  EXEQUENTE: GERALDO BATISTA NEVES (ESPóLIO DE)  EXECUTADO: ${ESTADO}`,
      }),
    ];
    expect(escolherCredor(pubs).nome).toBe('GERALDO BATISTA NEVES (ESPÓLIO)');
  });

  it('cabeçalho sem rótulo conta como cabeçalho', () => {
    const pubs = [
      pub({
        texto: `${VARA}   ${CNJ_MASC}  : GERALDO BATISTA NEVES (ESPÓLIO DE) E OUTROS (3)  : ${ESTATAL} E OUTROS (1)  Destinatário: GERALDO BATISTA NEVES    NOTIFICAÇÃO PJe-JT`,
        destinatarios: [
          ['ADEMIR SOUTO CAVALCANTI', 'A'],
          [ESTATAL, 'P'],
        ],
      }),
    ];
    const c = escolherCredor(pubs);
    expect(c.nome).toBe('GERALDO BATISTA NEVES (ESPÓLIO)');
    expect(c.fonte).toBe('cabecalho');
    expect(c.plurima).toBe(true);
    // Só polo A (+1) contra cabeçalho (10): o perito não detectado fica atrás.
    expect(c.outros).toEqual(['ADEMIR SOUTO CAVALCANTI']);
  });

  it('acórdão sem rótulo com a estatal primeiro: o 2º nome é o recorrido', () => {
    const pubs = [
      pub({
        texto: `SEGUNDA TURMA  Relatora: FULANA DE TAL   ${CNJ_MASC}  : ${ESTATAL} E OUTROS (1)  : LUCIANA MOTA FARIAS  PROCESSO nº ${CNJ_MASC} (AP)`,
        destinatarios: [[ESTATAL, 'A']],
      }),
    ];
    const c = escolherCredor(pubs);
    expect(c.nome).toBe('LUCIANA MOTA FARIAS');
    expect(c.fonte).toBe('recurso');
  });

  it('cabeçalho vence polo; empate vai pra publicação mais recente', () => {
    const cabecalho = pub({
      data: '2025-01-10',
      texto: `${VARA}  ATOrd ${CNJ_MASC}  AUTOR: MARTA DE SOUZA LIMA  RÉU: ${ESTADO}`,
      destinatarios: [['ANA BEATRIZ COSTA', 'A']],
    });
    expect(escolherCredor([cabecalho]).nome).toBe('MARTA DE SOUZA LIMA');

    const antiga = pub({
      data: '2024-01-10',
      texto: NOTIFICACAO_SIMPLES,
      destinatarios: [['ANA BEATRIZ COSTA', 'A']],
    });
    const recente = pub({
      data: '2025-01-10',
      texto: NOTIFICACAO_SIMPLES,
      destinatarios: [['BRUNO DIAS ROCHA', 'A']],
    });
    // Ordem de entrada invertida de propósito: a função não confia nela.
    expect(escolherCredor([antiga, recente]).nome).toBe('BRUNO DIAS ROCHA');
  });

  it('ignora publicação cancelada', () => {
    const pubs = [
      pub({
        cancelada: true,
        texto: `${VARA}  ATOrd ${CNJ_MASC}  AUTOR: MARTA DE SOUZA LIMA  RÉU: ${ESTADO}`,
      }),
      pub({ texto: NOTIFICACAO_SIMPLES, destinatarios: [['LUCIANA MOTA FARIAS', 'A']] }),
    ];
    expect(escolherCredor(pubs).nome).toBe('LUCIANA MOTA FARIAS');
  });
});

// ---------------------------------------------------------------------------

const ADV_CREDOR: AdvFixture = { id: 501, nome: 'VITOR HUGO SALES', oab: '12345' };
const ADV_DEVEDOR: AdvFixture = { id: 502, nome: 'ALINE MOURA BASTOS', oab: '6789' };
const ADV_DEVEDOR_2: AdvFixture = { id: 503, nome: 'CAMILA REIS FONTES', oab: '4321' };

describe('escolherAdvogado', () => {
  it('escolhe o do lado credor, mesmo vindo depois na ordem alfabética', () => {
    const pubs = [
      pub({
        texto: `${VARA}  CumSen ${CNJ_MASC}  EXEQUENTE: LUCIANA MOTA FARIAS  EXECUTADO: ${ESTATAL} E OUTROS (1)  DESTINATÁRIO(S): EXEQUENTE: LUCIANA MOTA FARIAS  ADVOGADO: VITOR HUGO SALES, OAB: 12345  EXECUTADO: ${ESTATAL}  ADVOGADO: ALINE MOURA BASTOS, OAB: 6789     NOTIFICAÇÃO PJe-JT`,
        destinatarios: [
          [ESTATAL, 'P'],
          ['LUCIANA MOTA FARIAS', 'A'],
        ],
        advogados: [ADV_DEVEDOR, ADV_CREDOR],
      }),
    ];
    expect(escolherAdvogado(pubs, 'LUCIANA MOTA FARIAS')).toEqual({
      nome: 'VITOR HUGO SALES',
      oab: '12345/AL',
    });
  });

  it('formato "fica notificado ... por seu advogado(a)": um voto pra cada lado', () => {
    const pubs = [
      pub({
        data: '2025-05-02',
        texto: `${VARA}  ATOrd ${CNJ_MASC}  AUTOR: DENIS ARAGAO PINTO  RÉU: ${ESTATAL} E OUTROS (1)  NOTIFICAÇÃO PJE - JTPor meio da presente, fica regularmente notificada(o) a(o) RECLAMADA(O)/RECORRIDO(A): ${ESTATAL}, por seu advogado(a): ALINE MOURA BASTOS, OAB: 6789`,
        destinatarios: [
          [ESTATAL, 'P'],
          ['DENIS ARAGAO PINTO', 'A'],
        ],
        advogados: [ADV_DEVEDOR, ADV_CREDOR],
      }),
      pub({
        data: '2025-05-01',
        texto: `${VARA}  ATOrd ${CNJ_MASC}  AUTOR: DENIS ARAGAO PINTO  RÉU: ${ESTATAL} E OUTROS (1)  NOTIFICAÇÃO PJE - JT Por meio da presente, fica regularmente notificado(a) a(o) DENIS ARAGAO PINTO, por seu advogado(a): VITOR HUGO SALES, OAB: 12345, a fim de cumprir`,
        destinatarios: [
          [ESTATAL, 'P'],
          ['DENIS ARAGAO PINTO', 'A'],
        ],
        advogados: [ADV_DEVEDOR, ADV_CREDOR],
      }),
    ];
    expect(escolherAdvogado(pubs)?.nome).toBe('VITOR HUGO SALES');
  });

  it('nunca escolhe o advogado do executado: só ele no texto → null', () => {
    const pubs = [
      pub({
        texto: `${VARA}  CumSen ${CNJ_MASC}  EXEQUENTE: LUCIANA MOTA FARIAS  EXECUTADO: ${ESTATAL} E OUTROS (1)  INTIMAÇÃO Fica intimado(a) executoriamente ${ESTATAL}, por seu(s) advogado(s) legalmente constituídos nos autos: Advogados do executado: ALINE MOURA BASTOS, CAMILA REIS FONTES, para comprovar o pagamento`,
        destinatarios: [
          [ESTATAL, 'P'],
          ['LUCIANA MOTA FARIAS', 'A'],
        ],
        advogados: [ADV_DEVEDOR, ADV_DEVEDOR_2, ADV_CREDOR],
      }),
    ];
    expect(escolherAdvogado(pubs, 'LUCIANA MOTA FARIAS')).toBeNull();
  });

  it('consolidarProcesso lista os advogados do lado que deve (o recálculo só apaga esses)', () => {
    const pubs = [
      pub({
        texto: `${VARA}  CumSen ${CNJ_MASC}  EXEQUENTE: LUCIANA MOTA FARIAS  EXECUTADO: ${ESTATAL} E OUTROS (1)  DESTINATÁRIO(S): EXEQUENTE: LUCIANA MOTA FARIAS  ADVOGADO: VITOR HUGO SALES, OAB: 12345  EXECUTADO: ${ESTATAL}  ADVOGADO: ALINE MOURA BASTOS, OAB: 6789     NOTIFICAÇÃO PJe-JT`,
        destinatarios: [
          [ESTATAL, 'P'],
          ['LUCIANA MOTA FARIAS', 'A'],
        ],
        advogados: [ADV_DEVEDOR, ADV_CREDOR],
      }),
    ];
    const r = consolidarProcesso(pubs);
    expect(r.advogado?.nome).toBe('VITOR HUGO SALES');
    expect(r.advogadosDevedor.map((a) => a.nome)).toEqual(['ALINE MOURA BASTOS']);
  });

  it('texto que não cita advogado → null (nunca cai em advogados[0])', () => {
    const pubs = [
      pub({
        texto: NOTIFICACAO_SIMPLES,
        destinatarios: [['LUCIANA MOTA FARIAS', 'A']],
        advogados: [ADV_DEVEDOR, ADV_CREDOR],
      }),
    ];
    expect(escolherAdvogado(pubs, 'LUCIANA MOTA FARIAS')).toBeNull();
  });

  it('troca de seção não vota: beneficiário de alvará logo depois do "RÉU:"', () => {
    const dest: Array<[string, Polo]> = [
      [ESTADO, 'P'],
      ['DENIS ARAGAO PINTO', 'A'],
    ];
    const pubs = [
      pub({
        data: '2025-09-01',
        texto: `${VARA}  ATOrd ${CNJ_MASC}  AUTOR: DENIS ARAGAO PINTO  RÉU: ${ESTADO}  INTIMAÇÃO Fica o(a) beneficiário(a) VITOR HUGO SALES intimado(a) de que foi expedido alvará judicial`,
        destinatarios: dest,
        advogados: [ADV_CREDOR],
      }),
      pub({
        data: '2025-08-01',
        texto: `${VARA}  ATOrd ${CNJ_MASC}  AUTOR: DENIS ARAGAO PINTO  RÉU: ${ESTADO}  NOTIFICAÇÃO PJE - JT Por meio da presente, fica regularmente notificado(a) a(o) DENIS ARAGAO PINTO, por seu advogado(a): VITOR HUGO SALES, OAB: 12345`,
        destinatarios: dest,
        advogados: [ADV_CREDOR],
      }),
    ];
    // Se o alvará contasse como voto de devedor (o "ESTADO" do cabeçalho é a
    // parte mais perto), ficaria 1 x 1 e o advogado do credor sumiria.
    expect(escolherAdvogado(pubs)?.nome).toBe('VITOR HUGO SALES');
  });

  it('"Advogado(s) de: NOME" — a parte vem depois do advogado', () => {
    const pubs = [
      pub({
        texto: `${VARA}   ${CNJ_MASC}  : DENIS ARAGAO PINTO E OUTROS (1)  : ${ESTATAL} E OUTROS (1)  DESTINATÁRIO(S):  Vitor Hugo Sales, OAB: 12345 Advogado(s) de: DENIS ARAGAO PINTO`,
        destinatarios: [
          [ESTATAL, 'P'],
          ['DENIS ARAGAO PINTO', 'A'],
        ],
        advogados: [ADV_CREDOR],
      }),
    ];
    expect(escolherAdvogado(pubs)?.nome).toBe('VITOR HUGO SALES');
  });

  it('a mesma OAB com e sem hífen (e id diferente) conta como um advogado só', () => {
    // O DJEN troca o id entre publicações e às vezes a grafia do nome junto.
    // Só a OAB normalizada liga "LEMOS 6191-B" a "LEMES 6191B".
    const credorComHifen: AdvFixture = { id: 610, nome: 'OSCAR PEIXOTO LEMOS', oab: '6191-B' };
    const credorSemHifen: AdvFixture = { id: 611, nome: 'OSCAR PEIXOTO LEMES', oab: '6191B' };
    const outroCredor: AdvFixture = { id: 612, nome: 'RITA CAMPOS VELOSO', oab: '7777' };
    const notifica = (adv: string) =>
      `${VARA}  ATOrd ${CNJ_MASC}  AUTOR: DENIS ARAGAO PINTO  RÉU: ${ESTADO}  NOTIFICAÇÃO PJE - JT Por meio da presente, fica regularmente notificado(a) a(o) DENIS ARAGAO PINTO, por seu advogado(a): ${adv}, a fim de cumprir`;
    const dest: Array<[string, Polo]> = [
      [ESTADO, 'P'],
      ['DENIS ARAGAO PINTO', 'A'],
    ];
    const pubs = [
      // A mais recente cita a outra advogada: se o Oscar fosse contado como
      // dois advogados de 1 voto cada, ela venceria pelo desempate de recência.
      pub({
        data: '2025-09-01',
        texto: notifica('RITA CAMPOS VELOSO'),
        destinatarios: dest,
        advogados: [credorSemHifen, outroCredor],
      }),
      pub({
        data: '2025-08-01',
        texto: notifica('OSCAR PEIXOTO LEMES'),
        destinatarios: dest,
        advogados: [credorSemHifen],
      }),
      pub({
        data: '2025-07-01',
        texto: notifica('OSCAR PEIXOTO LEMOS'),
        destinatarios: dest,
        advogados: [credorComHifen],
      }),
    ];
    const adv = escolherAdvogado(pubs);
    // Grafia da publicação mais recente onde ele aparece listado.
    expect(adv).toEqual({ nome: 'OSCAR PEIXOTO LEMES', oab: '6191B/AL' });
  });
});

// ---------------------------------------------------------------------------

function flag(codigo: string): RedFlag {
  return { codigo, categoria: 'NAVEGACIONAL', cor: 'cinza', precisao: 1, trecho: '', contexto: '' };
}

describe('codigosDedup', () => {
  it('deduplica mantendo a ordem da primeira aparição', () => {
    const flags = ['9', 'X1', '9', '4e', 'X1', '10'].map(flag);
    expect(codigosDedup(flags)).toEqual(['9', 'X1', '4e', '10']);
  });

  it('lista vazia → vazia', () => {
    expect(codigosDedup([])).toEqual([]);
  });
});

describe('consolidarProcesso', () => {
  it('junta credor, advogado e red flags das publicações válidas', () => {
    const pubs = [
      pub({
        data: '2025-09-01',
        texto: `${VARA}  CumSen ${CNJ_MASC}  EXEQUENTE: LUCIANA MOTA FARIAS  EXECUTADO: ${ESTADO}  DESTINATÁRIO(S): EXEQUENTE: LUCIANA MOTA FARIAS  ADVOGADO: VITOR HUGO SALES, OAB: 12345  DESPACHO Expeça-se ofício requisitório. Certifique-se o trânsito em julgado.`,
        destinatarios: [
          ['ADEMIR SOUTO CAVALCANTI', 'A'],
          [ESTADO, 'P'],
          ['LUCIANA MOTA FARIAS', 'A'],
        ],
        advogados: [ADV_DEVEDOR, ADV_CREDOR],
      }),
      pub({
        data: '2025-08-01',
        cancelada: true,
        texto: 'Homologo a cessão de crédito formalizada entre as partes.',
        destinatarios: [['ADEMIR SOUTO CAVALCANTI', 'A']],
      }),
    ];
    const r = consolidarProcesso(pubs, { peritos: new Set(['ADEMIR SOUTO CAVALCANTI']) });
    expect(r.credor.nome).toBe('LUCIANA MOTA FARIAS');
    expect(r.credor.outros).toEqual([]);
    expect(r.advogado).toEqual({ nome: 'VITOR HUGO SALES', oab: '12345/AL' });
    expect(r.redFlags).toEqual(codigosDedup(pubs[0]!.redFlags));
    // A cessão estava só na publicação cancelada.
    expect(r.redFlags).not.toContain('1');
  });
});
