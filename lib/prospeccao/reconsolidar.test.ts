import { describe, expect, it } from 'vitest';
import { consolidarProcesso } from '@/lib/djen/consolidar';
import { mapCruParaPublicacao } from '@/lib/djen/mappers';
import type { CredorConsolidado } from '@/lib/djen/consolidar';
import type { DjenItem, Polo } from '@/lib/djen/types.raw';
import {
  calcularDiffs,
  hashDiff,
  montarAtualizacoes,
  resumirDiffs,
  type LinhaDiff,
  type LinhaProspeccaoAtual,
  type ProcessoConsolidado,
} from './reconsolidar';

/*
 * Nomes FICTÍCIOS (o repo é público). O formato imita o que o batch grava em
 * prospeccao_precatorios (nome cru do PJe, OAB "1234/AL", códigos de flag) e
 * o que a consolidação devolve.
 */

const CNJ_A = '00001111120235190001';
const CNJ_B = '00002222220225190002';
const CNJ_C = '00003333320215190003';

function linha(extra: Partial<LinhaProspeccaoAtual> = {}): LinhaProspeccaoAtual {
  return {
    id: 'id-a',
    numero_processo: CNJ_A,
    valor_face: 100_000,
    status: 'enriquecido',
    cedente_nome_provavel: 'FULANO DE TAL DA SILVA',
    advogado_nome: 'BELTRANO MACHADO SOUZA',
    advogado_oab: '1234/AL',
    red_flags: ['X1'],
    ...extra,
  };
}

function credor(nome: string | null, extra: Partial<CredorConsolidado> = {}): CredorConsolidado {
  return {
    nome,
    fonte: nome ? 'cabecalho' : null,
    plurima: false,
    espolio: false,
    outros: [],
    ...extra,
  };
}

function proc(extra: Partial<ProcessoConsolidado> = {}): ProcessoConsolidado {
  return {
    credor: credor('FULANO DE TAL DA SILVA'),
    advogado: { nome: 'BELTRANO MACHADO SOUZA', oab: '1234/AL' },
    redFlags: ['X1'],
    advogadosCitados: [],
    ...extra,
  };
}

function diffsDe(
  l: LinhaProspeccaoAtual,
  p: ProcessoConsolidado,
  peritos?: ReadonlySet<string>,
): LinhaDiff[] {
  return calcularDiffs([l], new Map([[l.numero_processo, p]]), { peritos });
}

function soCampo(diffs: LinhaDiff[], campo: LinhaDiff['campo']): LinhaDiff | undefined {
  const achados = diffs.filter((d) => d.campo === campo);
  expect(achados.length).toBeLessThanOrEqual(1);
  return achados[0];
}

const PROCURADOR = { nome: 'PROCURADOR ESTADUAL EXEMPLO', oab: '9999/AL' };

/**
 * O advogado aparece do lado que deve neste processo E em outro (CNJ_C): só
 * com 2+ processos o recálculo apaga ou troca o advogado gravado.
 */
function comLoteDevedor(
  l: LinhaProspeccaoAtual,
  p: ProcessoConsolidado,
  devedor: { nome: string; oab: string },
): LinhaDiff[] {
  const consolidados = new Map([
    [l.numero_processo, { ...p, advogadosDevedor: [devedor] }],
    [CNJ_C, proc({ advogado: null, advogadosDevedor: [devedor] })],
  ]);
  return calcularDiffs([l], consolidados);
}

// ---------------------------------------------------------------------------

describe('calcularDiffs — sem mudança', () => {
  it('linha igual ao consolidado não gera diff', () => {
    expect(diffsDe(linha(), proc())).toEqual([]);
  });

  it('acento e caixa diferentes no credor não contam como mudança', () => {
    const l = linha({ cedente_nome_provavel: 'Fulano de Tál da Silva' });
    expect(soCampo(diffsDe(l, proc()), 'credor')).toBeUndefined();
  });

  it('linha cujo processo não tem consolidado fica de fora', () => {
    const l = linha({ cedente_nome_provavel: 'ESTADO DE ALAGOAS', red_flags: ['4'] });
    expect(calcularDiffs([l], new Map())).toEqual([]);
  });
});

describe('calcularDiffs — credor a corrigir', () => {
  it('credor vazio ganha o nome do cabeçalho', () => {
    const d = soCampo(diffsDe(linha({ cedente_nome_provavel: null }), proc()), 'credor');
    expect(d).toMatchObject({
      tipo: 'corrigir',
      antes: null,
      depois: 'FULANO DE TAL DA SILVA',
    });
    expect(d!.motivo).toMatch(/vazio/i);
    expect(d!.motivo).toMatch(/cabeçalho/);
  });

  it('string vazia conta como vazio', () => {
    const d = soCampo(diffsDe(linha({ cedente_nome_provavel: '   ' }), proc()), 'credor');
    expect(d).toMatchObject({ tipo: 'corrigir', antes: null });
  });

  it('ente público gravado como credor é corrigido', () => {
    const d = soCampo(
      diffsDe(linha({ cedente_nome_provavel: 'ESTADO DE ALAGOAS' }), proc()),
      'credor',
    );
    expect(d).toMatchObject({
      tipo: 'corrigir',
      antes: 'ESTADO DE ALAGOAS',
      depois: 'FULANO DE TAL DA SILVA',
    });
    expect(d!.motivo).toMatch(/ente público/);
  });

  it('estatal (Caixa) gravada como credor é corrigida', () => {
    const d = soCampo(
      diffsDe(linha({ cedente_nome_provavel: 'CAIXA ECONOMICA FEDERAL' }), proc()),
      'credor',
    );
    expect(d?.tipo).toBe('corrigir');
  });

  it('sociedade de advogados gravada como credor é corrigida', () => {
    const d = soCampo(
      diffsDe(
        linha({ cedente_nome_provavel: 'CICRANO PEREIRA SOCIEDADE INDIVIDUAL DE ADVOCACIA' }),
        proc(),
      ),
      'credor',
    );
    expect(d).toMatchObject({ tipo: 'corrigir' });
    expect(d!.motivo).toMatch(/empresa, escritório ou sindicato/);
  });

  it('perito do lote gravado como credor é corrigido', () => {
    const peritos = new Set(['OTAVIO CALCULOS RAMOS']);
    const d = soCampo(
      diffsDe(linha({ cedente_nome_provavel: 'Otavio Calculos Ramos' }), proc(), peritos),
      'credor',
    );
    expect(d).toMatchObject({ tipo: 'corrigir', depois: 'FULANO DE TAL DA SILVA' });
    expect(d!.motivo).toMatch(/perito/);
  });

  it('sem o conjunto de peritos o mesmo nome seria pessoa física → revisar', () => {
    const d = soCampo(
      diffsDe(linha({ cedente_nome_provavel: 'OTAVIO CALCULOS RAMOS' }), proc()),
      'credor',
    );
    expect(d?.tipo).toBe('revisar');
  });

  it('advogado do processo gravado como credor é corrigido', () => {
    const d = soCampo(
      diffsDe(
        linha({ cedente_nome_provavel: 'BELTRANO MACHADO SOUZA' }),
        proc({ advogadosCitados: ['BELTRANO MACHADO SOUZA'] }),
      ),
      'credor',
    );
    expect(d).toMatchObject({ tipo: 'corrigir' });
    expect(d!.motivo).toMatch(/advogado do processo/);
  });

  it('nome mascarado pelo tribunal é corrigido (com e sem espaço)', () => {
    for (const mascarado of ['J.M.C.D.S.', 'J. M. C. DOS S.']) {
      const d = soCampo(diffsDe(linha({ cedente_nome_provavel: mascarado }), proc()), 'credor');
      expect(d, mascarado).toMatchObject({ tipo: 'corrigir' });
      expect(d!.motivo).toMatch(/mascarado/);
    }
  });

  it('sigla de uma palavra só é corrigida', () => {
    const d = soCampo(diffsDe(linha({ cedente_nome_provavel: 'SINDEXEMPLO' }), proc()), 'credor');
    expect(d?.tipo).toBe('corrigir');
  });

  it('motivo diz de onde veio o nome novo (recurso, polo)', () => {
    const l = linha({ cedente_nome_provavel: 'ESTADO DE ALAGOAS' });
    const recurso = soCampo(
      diffsDe(l, proc({ credor: credor('FULANO DE TAL DA SILVA', { fonte: 'recurso' }) })),
      'credor',
    );
    expect(recurso!.motivo).toMatch(/recurso/);
    const polo = soCampo(
      diffsDe(l, proc({ credor: credor('FULANO DE TAL DA SILVA', { fonte: 'polo' }) })),
      'credor',
    );
    expect(polo!.motivo).toMatch(/destinatários/);
  });

  it('mesmo credor ganhando "(ESPÓLIO)" é corrigido', () => {
    const d = soCampo(
      diffsDe(
        linha({ cedente_nome_provavel: 'FULANO DE TAL DA SILVA' }),
        proc({ credor: credor('FULANO DE TAL DA SILVA (ESPÓLIO)', { espolio: true }) }),
      ),
      'credor',
    );
    expect(d).toMatchObject({ tipo: 'corrigir', depois: 'FULANO DE TAL DA SILVA (ESPÓLIO)' });
    expect(d!.motivo).toMatch(/espólio/);
  });

  it('"ESPÓLIO DE NOME" vira "NOME (ESPÓLIO)": mesma pessoa, só a grafia', () => {
    const d = soCampo(
      diffsDe(
        linha({ cedente_nome_provavel: 'ESPOLIO DE FULANO DE TAL DA SILVA' }),
        proc({ credor: credor('FULANO DE TAL DA SILVA (ESPÓLIO)', { espolio: true }) }),
      ),
      'credor',
    );
    expect(d).toMatchObject({ tipo: 'corrigir' });
    expect(d!.motivo).toMatch(/grafia/);
  });
});

describe('calcularDiffs — credor a revisar (nunca aplica)', () => {
  it('pessoa física válida trocada por outra pessoa em ação plúrima', () => {
    const d = soCampo(
      diffsDe(
        linha({ cedente_nome_provavel: 'ANA COAUTORA DOS SANTOS' }),
        proc({
          credor: credor('BRUNO PRIMEIRO AUTOR LIMA', {
            plurima: true,
            outros: ['ANA COAUTORA DOS SANTOS', 'CARLA TERCEIRA COSTA'],
          }),
        }),
      ),
      'credor',
    );
    expect(d).toMatchObject({
      tipo: 'revisar',
      antes: 'ANA COAUTORA DOS SANTOS',
      depois: 'BRUNO PRIMEIRO AUTOR LIMA',
    });
    expect(d!.motivo).toMatch(/vários credores/);
    expect(d!.motivo).toMatch(/Confira no PJe/);
  });

  it('espólio no cabeçalho com o atual entre os coautores: o atual pode ser o herdeiro', () => {
    const d = soCampo(
      diffsDe(
        linha({ cedente_nome_provavel: 'ANA HERDEIRA DOS SANTOS' }),
        proc({
          credor: credor('BRUNO FALECIDO LIMA (ESPÓLIO)', {
            espolio: true,
            plurima: true,
            outros: ['ANA HERDEIRA DOS SANTOS'],
          }),
        }),
      ),
      'credor',
    );
    expect(d?.tipo).toBe('revisar');
    expect(d!.motivo).toMatch(/herdeiro habilitado/);
  });

  it('sem cabeçalho (só o polo) o motivo manda manter o atual', () => {
    const d = soCampo(
      diffsDe(
        linha({ cedente_nome_provavel: 'ANA SUBSTITUIDA DOS SANTOS' }),
        proc({ credor: credor('BRUNO DO POLO LIMA', { fonte: 'polo' }) }),
      ),
      'credor',
    );
    expect(d?.tipo).toBe('revisar');
    expect(d!.motivo).toMatch(/Mantenha o atual/);
  });

  it('plúrima em que o nome atual não aparece entre os coautores', () => {
    const d = soCampo(
      diffsDe(
        linha({ cedente_nome_provavel: 'ANA COAUTORA DOS SANTOS' }),
        proc({ credor: credor('BRUNO PRIMEIRO AUTOR LIMA', { plurima: true }) }),
      ),
      'credor',
    );
    expect(d?.tipo).toBe('revisar');
    expect(d!.motivo).toMatch(/vários credores/);
  });

  it('outra pessoa sem plúrima (pode ser grafia diferente)', () => {
    const d = soCampo(
      diffsDe(
        linha({ cedente_nome_provavel: 'WALDOMIRA SIRQUEIRA EXEMPLO' }),
        proc({ credor: credor('WALDOMIRA SIQUEIRA EXEMPLO') }),
      ),
      'credor',
    );
    expect(d?.tipo).toBe('revisar');
    expect(d!.motivo).toMatch(/outra grafia/);
  });

  it('nome atual com espólio e recálculo sem espólio → revisar', () => {
    const d = soCampo(
      diffsDe(
        linha({ cedente_nome_provavel: 'FULANO DE TAL DA SILVA (ESPÓLIO)' }),
        proc({ credor: credor('FULANO DE TAL DA SILVA') }),
      ),
      'credor',
    );
    expect(d?.tipo).toBe('revisar');
  });

  it('recálculo sem credor nunca apaga o nome atual', () => {
    const valido = soCampo(diffsDe(linha(), proc({ credor: credor(null) })), 'credor');
    expect(valido).toMatchObject({ tipo: 'revisar', depois: null });

    const ente = soCampo(
      diffsDe(
        linha({ cedente_nome_provavel: 'ESTADO DE ALAGOAS' }),
        proc({ credor: credor(null) }),
      ),
      'credor',
    );
    expect(ente).toMatchObject({ tipo: 'revisar', depois: null });
    expect(ente!.motivo).toMatch(/ente público/);
  });

  it('vazio antes e depois não gera diff', () => {
    const d = soCampo(
      diffsDe(linha({ cedente_nome_provavel: null }), proc({ credor: credor(null) })),
      'credor',
    );
    expect(d).toBeUndefined();
  });
});

describe('calcularDiffs — advogado', () => {
  it('advogado do lado que deve em 2+ processos vira vazio (corrigir)', () => {
    const d = soCampo(
      comLoteDevedor(linha(), proc({ advogado: null }), {
        nome: 'BELTRANO MACHADO SOUZA',
        oab: '1234/AL',
      }),
      'advogado',
    );
    expect(d).toMatchObject({
      tipo: 'corrigir',
      antes: 'BELTRANO MACHADO SOUZA · OAB 1234/AL',
      depois: null,
    });
    expect(d!.motivo).toMatch(/lado que deve/);
  });

  it('voto de devedor num processo só fica pra conferência (revisar)', () => {
    // A proximidade no texto erra às vezes: num RO real, o advogado do
    // trabalhador recorrente saía como do devedor.
    const d = soCampo(
      diffsDe(
        linha(),
        proc({
          advogado: null,
          advogadosDevedor: [{ nome: 'BELTRANO MACHADO SOUZA', oab: '1234/AL' }],
        }),
      ),
      'advogado',
    );
    expect(d?.tipo).toBe('revisar');
    expect(d!.motivo).toMatch(/só aqui/);
  });

  it('advogado sem evidência de lado nenhum fica como está', () => {
    // A 1ª versão apagava: nos dados reais isso jogava fora advogados do
    // credor que o texto só não amarrava a uma parte.
    expect(soCampo(diffsDe(linha(), proc({ advogado: null })), 'advogado')).toBeUndefined();
  });

  it('advogado do mesmo time (sem evidência de devedor) não é trocado', () => {
    const l = linha({ advogado_nome: 'CICERA SOCIA DO ESCRITORIO', advogado_oab: '5555/AL' });
    expect(soCampo(diffsDe(l, proc()), 'advogado')).toBeUndefined();
  });

  it('vazio ganha o advogado do credor', () => {
    const d = soCampo(
      diffsDe(linha({ advogado_nome: null, advogado_oab: null }), proc()),
      'advogado',
    );
    expect(d).toMatchObject({
      tipo: 'corrigir',
      antes: null,
      depois: 'BELTRANO MACHADO SOUZA · OAB 1234/AL',
    });
  });

  it('troca de advogado (procurador do devedor → advogado do credor)', () => {
    const d = soCampo(
      comLoteDevedor(
        linha({ advogado_nome: 'PROCURADOR ESTADUAL EXEMPLO', advogado_oab: '9999/AL' }),
        proc(),
        PROCURADOR,
      ),
      'advogado',
    );
    expect(d).toMatchObject({
      tipo: 'corrigir',
      antes: 'PROCURADOR ESTADUAL EXEMPLO · OAB 9999/AL',
      depois: 'BELTRANO MACHADO SOUZA · OAB 1234/AL',
    });
  });

  it('mesma OAB com e sem hífen ou zero à esquerda não é mudança', () => {
    const l = linha({ advogado_nome: 'Beltrano Machado Souza', advogado_oab: '06191-B/al' });
    const p = proc({ advogado: { nome: 'BELTRANO MACHADO SOUZA', oab: '6191B/AL' } });
    expect(soCampo(diffsDe(l, p), 'advogado')).toBeUndefined();
  });

  it('mesmo nome com OAB diferente é corrigido', () => {
    const d = soCampo(diffsDe(linha({ advogado_oab: '4321/AL' }), proc()), 'advogado');
    expect(d).toMatchObject({ tipo: 'corrigir' });
    expect(d!.motivo).toMatch(/OAB/);
  });

  it('vazio antes e depois não gera diff', () => {
    const l = linha({ advogado_nome: null, advogado_oab: null });
    expect(soCampo(diffsDe(l, proc({ advogado: null })), 'advogado')).toBeUndefined();
  });
});

describe('calcularDiffs — advogado do credor em outro processo do lote', () => {
  // O mesmo advogado foi escolhido como do credor em CNJ_B (e CNJ_C); em
  // CNJ_A o texto não amarra o nome a ninguém, então a consolidação dá null.
  const outro = proc({ advogado: { nome: 'BELTRANO MACHADO SOUZA', oab: '1234/AL' } });

  it('não é apagado: vira revisar, citando quantos processos', () => {
    const l = linha({ numero_processo: CNJ_A });
    const consolidados = new Map([
      [CNJ_A, proc({ advogado: null })],
      [CNJ_B, outro],
    ]);
    const d = soCampo(calcularDiffs([l], consolidados), 'advogado');
    expect(d).toMatchObject({
      tipo: 'revisar',
      antes: 'BELTRANO MACHADO SOUZA · OAB 1234/AL',
      depois: null,
    });
    expect(d!.motivo).toMatch(/advogado do credor em outro processo do lote/);

    consolidados.set(CNJ_C, outro);
    const d2 = soCampo(calcularDiffs([l], consolidados), 'advogado');
    expect(d2!.motivo).toMatch(/em 2 outros processos/);
  });

  it('reconhece pela OAB mesmo com o nome grafado diferente', () => {
    const l = linha({ advogado_nome: 'BELTRANO M. SOUZA', advogado_oab: '01234/al' });
    const consolidados = new Map([
      [CNJ_A, proc({ advogado: null })],
      [CNJ_B, outro],
    ]);
    expect(soCampo(calcularDiffs([l], consolidados), 'advogado')?.tipo).toBe('revisar');
  });

  it('advogado do credor no lote não é trocado por outro advogado do credor', () => {
    const l = linha();
    const consolidados = new Map([
      [CNJ_A, proc({ advogado: { nome: 'XAVIER CREDORIO MACHADO', oab: '2222/AL' } })],
      [CNJ_B, outro],
    ]);
    expect(soCampo(calcularDiffs([l], consolidados), 'advogado')).toBeUndefined();
  });

  it('procurador votado como devedor em 2 outros processos do lote vai pra vazio', () => {
    const l = linha({ advogado_nome: 'PROCURADOR ESTADUAL EXEMPLO', advogado_oab: '9999/AL' });
    const dev = proc({ advogadosDevedor: [PROCURADOR] });
    const consolidados = new Map([
      [CNJ_A, proc({ advogado: null })],
      [CNJ_B, dev],
    ]);
    // Um processo só não basta…
    expect(soCampo(calcularDiffs([l], consolidados), 'advogado')).toBeUndefined();
    // …dois bastam.
    consolidados.set(CNJ_C, dev);
    expect(soCampo(calcularDiffs([l], consolidados), 'advogado')?.tipo).toBe('corrigir');
  });

  it('votado como devedor num processo mas escolhido pro credor em outro: não apaga', () => {
    const l = linha();
    const consolidados = new Map([
      [CNJ_A, proc({ advogado: null })],
      [CNJ_B, outro],
      [CNJ_C, proc({ advogadosDevedor: [{ nome: 'BELTRANO MACHADO SOUZA', oab: '1234/AL' }] })],
    ]);
    expect(soCampo(calcularDiffs([l], consolidados), 'advogado')?.tipo).toBe('revisar');
  });
});

describe('calcularDiffs — red flags', () => {
  it('conjunto diferente é corrigido, com o que entra e o que sai', () => {
    const d = soCampo(
      diffsDe(linha({ red_flags: ['X1', '4', '9'] }), proc({ redFlags: ['X1', '4e', '9'] })),
      'red_flags',
    );
    expect(d).toMatchObject({
      tipo: 'corrigir',
      antes: 'X1, 4, 9',
      depois: 'X1, 4e, 9',
      motivo: 'Entra: 4e · Sai: 4',
    });
  });

  it('mesma lista em outra ordem não é mudança', () => {
    const l = linha({ red_flags: ['9', 'X1', 'X7'] });
    expect(soCampo(diffsDe(l, proc({ redFlags: ['X7', '9', 'X1'] })), 'red_flags')).toBeUndefined();
  });

  it('red_flags null conta como lista vazia', () => {
    const d = soCampo(diffsDe(linha({ red_flags: null }), proc({ redFlags: ['X1'] })), 'red_flags');
    expect(d).toMatchObject({ antes: null, depois: 'X1', motivo: 'Entra: X1' });
    expect(soCampo(diffsDe(linha({ red_flags: null }), proc({ redFlags: [] })), 'red_flags')).toBe(
      undefined,
    );
  });

  it('todas saindo: depois null, só "Sai"', () => {
    const d = soCampo(diffsDe(linha({ red_flags: ['4'] }), proc({ redFlags: [] })), 'red_flags');
    expect(d).toMatchObject({ antes: '4', depois: null, motivo: 'Sai: 4' });
  });
});

describe('calcularDiffs — ordem', () => {
  it('maior valor de face primeiro, sem valor no fim; campos na ordem credor, advogado, flags', () => {
    const linhas = [
      linha({
        id: 'p',
        numero_processo: CNJ_A,
        valor_face: 50_000,
        cedente_nome_provavel: null,
        red_flags: [],
      }),
      linha({
        id: 'g',
        numero_processo: CNJ_B,
        valor_face: 900_000,
        advogado_nome: null,
        advogado_oab: null,
      }),
      linha({ id: 'n', numero_processo: CNJ_C, valor_face: null, red_flags: [] }),
    ];
    const consolidados = new Map([
      [CNJ_A, proc()],
      [CNJ_B, proc()],
      [CNJ_C, proc()],
    ]);
    const ordem = calcularDiffs(linhas, consolidados).map((d) => `${d.id}:${d.campo}`);
    expect(ordem).toEqual(['g:advogado', 'p:credor', 'p:red_flags', 'n:red_flags']);
  });
});

// ---------------------------------------------------------------------------

describe('resumirDiffs', () => {
  it('conta credor por tipo, advogado e red flags', () => {
    const linhas = [
      linha({
        id: '1',
        numero_processo: CNJ_A,
        cedente_nome_provavel: 'ESTADO DE ALAGOAS',
        red_flags: ['4'],
      }),
      linha({ id: '2', numero_processo: CNJ_B, cedente_nome_provavel: 'ANA COAUTORA DOS SANTOS' }),
      // Advogado do credor em CNJ_B, sem evidência em CNJ_C → revisar.
      linha({ id: '3', numero_processo: CNJ_C }),
    ];
    linhas[0] = {
      ...linhas[0]!,
      advogado_nome: 'PROCURADOR ESTADUAL EXEMPLO',
      advogado_oab: '9999/AL',
    };
    const consolidados = new Map([
      [
        CNJ_A,
        proc({
          advogado: null,
          redFlags: ['4e'],
          advogadosDevedor: [{ nome: 'PROCURADOR ESTADUAL EXEMPLO', oab: '9999/AL' }],
        }),
      ],
      [CNJ_B, proc()],
      // O procurador também é do lado que deve aqui: 2 processos, então apaga.
      [CNJ_C, proc({ advogado: null, advogadosDevedor: [PROCURADOR] })],
    ]);
    expect(resumirDiffs(calcularDiffs(linhas, consolidados))).toEqual({
      credorCorrigir: 1,
      credorRevisar: 1,
      advogado: 1,
      advogadoRevisar: 1,
      redFlags: 1,
    });
  });

  it('lista vazia zera tudo', () => {
    expect(resumirDiffs([])).toEqual({
      credorCorrigir: 0,
      credorRevisar: 0,
      advogado: 0,
      advogadoRevisar: 0,
      redFlags: 0,
    });
  });
});

describe('hashDiff', () => {
  const base: LinhaDiff[] = [
    {
      id: '1',
      numero_processo: CNJ_A,
      valor_face: 10,
      campo: 'credor',
      antes: 'ESTADO DE ALAGOAS',
      depois: 'FULANO DE TAL DA SILVA',
      tipo: 'corrigir',
      motivo: 'x',
    },
    {
      id: '2',
      numero_processo: CNJ_B,
      valor_face: 20,
      campo: 'red_flags',
      antes: '4',
      depois: null,
      tipo: 'corrigir',
      motivo: 'y',
    },
  ];

  it('é determinístico e não depende da ordem de entrada', () => {
    expect(hashDiff(base)).toBe(hashDiff(base));
    expect(hashDiff([...base].reverse())).toBe(hashDiff(base));
    expect(hashDiff(base)).toMatch(/^2-[0-9a-f]{8}$/);
  });

  it('muda quando antes, depois, tipo ou campo mudam', () => {
    const h = hashDiff(base);
    const variar = (patch: Partial<LinhaDiff>) => hashDiff([{ ...base[0]!, ...patch }, base[1]!]);
    expect(variar({ depois: 'OUTRO NOME DA SILVA' })).not.toBe(h);
    expect(variar({ antes: null })).not.toBe(h);
    expect(variar({ tipo: 'revisar' })).not.toBe(h);
    expect(variar({ campo: 'advogado' })).not.toBe(h);
    expect(variar({ id: '3' })).not.toBe(h);
  });

  it('null e string vazia não colidem', () => {
    const vazio = hashDiff([{ ...base[0]!, antes: '' }]);
    const nulo = hashDiff([{ ...base[0]!, antes: null }]);
    expect(vazio).not.toBe(nulo);
  });

  it('diff vazio tem hash fixo', () => {
    expect(hashDiff([])).toBe('0-00001505');
  });

  it('motivo e valor de face não entram (não mudam o que é gravado)', () => {
    expect(hashDiff([{ ...base[0]!, motivo: 'outro' }, base[1]!])).toBe(hashDiff(base));
    expect(hashDiff([{ ...base[0]!, valor_face: 999 }, base[1]!])).toBe(hashDiff(base));
  });
});

// ---------------------------------------------------------------------------

describe('montarAtualizacoes', () => {
  it('um update por linha, só com as colunas dos diffs corrigir', () => {
    const l = linha({ cedente_nome_provavel: 'ESTADO DE ALAGOAS', red_flags: ['X1', '4'] });
    const p = proc({
      advogado: null,
      redFlags: ['X1', '4e'],
      advogadosDevedor: [{ nome: 'BELTRANO MACHADO SOUZA', oab: '1234/AL' }],
    });
    const consolidados = new Map([
      [CNJ_A, p],
      [CNJ_C, proc({ advogado: null, advogadosDevedor: p.advogadosDevedor })],
    ]);
    const diffs = calcularDiffs([l], consolidados);
    expect(montarAtualizacoes([l], consolidados, diffs)).toEqual([
      {
        id: 'id-a',
        numero_processo: CNJ_A,
        statusLido: 'enriquecido',
        colunas: {
          cedente_nome_provavel: 'FULANO DE TAL DA SILVA',
          advogado_nome: null,
          advogado_oab: null,
          red_flags: ['X1', '4e'],
        },
      },
    ]);
  });

  it('revisar nunca vira coluna; linha só com revisar não gera update', () => {
    const l = linha({ cedente_nome_provavel: 'ANA COAUTORA DOS SANTOS' });
    const consolidados = new Map([
      [CNJ_A, proc({ credor: credor('BRUNO PRIMEIRO AUTOR LIMA', { plurima: true }) })],
    ]);
    const diffs = calcularDiffs([l], consolidados);
    expect(diffs.map((d) => d.tipo)).toEqual(['revisar']);
    expect(montarAtualizacoes([l], consolidados, diffs)).toEqual([]);
  });

  it('advogado em revisar também não vira coluna', () => {
    const l = linha({ red_flags: ['4'] });
    const consolidados = new Map([
      [CNJ_A, proc({ advogado: null, redFlags: ['4e'] })],
      [CNJ_B, proc()],
    ]);
    const diffs = calcularDiffs([l], consolidados);
    expect(diffs.find((d) => d.campo === 'advogado')?.tipo).toBe('revisar');
    const [upd] = montarAtualizacoes([l], consolidados, diffs);
    expect(upd!.colunas).toEqual({ red_flags: ['4e'] });
  });

  it('revisar no credor não impede corrigir o advogado da mesma linha', () => {
    const l = linha({
      cedente_nome_provavel: 'ANA COAUTORA DOS SANTOS',
      advogado_nome: 'PROCURADOR ESTADUAL EXEMPLO',
      advogado_oab: '9999/AL',
    });
    const consolidados = new Map([
      [
        CNJ_A,
        proc({
          credor: credor('BRUNO PRIMEIRO AUTOR LIMA'),
          advogadosDevedor: [PROCURADOR],
        }),
      ],
      [CNJ_C, proc({ advogado: null, advogadosDevedor: [PROCURADOR] })],
    ]);
    const [upd] = montarAtualizacoes([l], consolidados, calcularDiffs([l], consolidados));
    expect(upd!.colunas).toEqual({
      advogado_nome: 'BELTRANO MACHADO SOUZA',
      advogado_oab: '1234/AL',
    });
    expect(upd!.colunas).not.toHaveProperty('cedente_nome_provavel');
  });

  it('nunca escreve status, judit_status nem judit_enriquecido_em', () => {
    const l = linha({
      status: 'importado',
      cedente_nome_provavel: null,
      advogado_nome: null,
      advogado_oab: null,
      red_flags: [],
    });
    const consolidados = new Map([[CNJ_A, proc()]]);
    const [upd] = montarAtualizacoes([l], consolidados, calcularDiffs([l], consolidados));
    expect(upd!.statusLido).toBe('importado');
    expect(Object.keys(upd!.colunas).sort()).toEqual(
      ['advogado_nome', 'advogado_oab', 'cedente_nome_provavel', 'red_flags'].sort(),
    );
  });

  it('diff corrigir de credor com depois null (bug) não apaga o credor', () => {
    const l = linha();
    const consolidados = new Map([[CNJ_A, proc({ credor: credor(null) })]]);
    const forjado: LinhaDiff = {
      id: 'id-a',
      numero_processo: CNJ_A,
      valor_face: 1,
      campo: 'credor',
      antes: 'FULANO DE TAL DA SILVA',
      depois: null,
      tipo: 'corrigir',
      motivo: '',
    };
    expect(montarAtualizacoes([l], consolidados, [forjado])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ponta a ponta com publicação no formato real (via mapCruParaPublicacao)
// ---------------------------------------------------------------------------

let seq = 800_000_000;

function item(opts: {
  texto: string;
  data: string;
  destinatarios: Array<[string, Polo]>;
  advogados: Array<{ id: number; nome: string; oab: string }>;
}): DjenItem {
  const id = ++seq;
  return {
    id,
    hash: `hash${id}`,
    data_disponibilizacao: opts.data,
    datadisponibilizacao: opts.data.split('-').reverse().join('/'),
    siglaTribunal: 'TRT19',
    tipoComunicacao: 'Intimação',
    nomeOrgao: '1ª Vara do Trabalho de Maceió',
    idOrgao: 1,
    texto: opts.texto,
    numero_processo: CNJ_A,
    numeroprocessocommascara: '0000111-11.2023.5.19.0001',
    meio: 'D',
    meiocompleto: 'Diário de Justiça Eletrônico Nacional',
    link: null,
    tipoDocumento: 'Notificação',
    nomeClasse: 'CUMPRIMENTO DE SENTENÇA',
    codigoClasse: '156',
    numeroComunicacao: 1,
    ativo: true,
    status: 'P',
    motivo_cancelamento: null,
    data_cancelamento: null,
    destinatarios: opts.destinatarios.map(([nome, polo]) => ({ comunicacao_id: id, nome, polo })),
    destinatarioadvogados: opts.advogados.map((a, i) => ({
      id: id * 10 + i,
      comunicacao_id: id,
      advogado_id: a.id,
      created_at: `${opts.data}T10:00:00`,
      updated_at: `${opts.data}T10:00:00`,
      advogado: { id: a.id, nome: a.nome, numero_oab: a.oab, uf_oab: 'AL' },
    })),
  };
}

describe('ponta a ponta: o erro do batch antigo vira correção', () => {
  it('ente 1º do polo A, procurador 1º advogado e flag 4 antiga → três correções', () => {
    // Formato real do TRT19: cabeçalho do PJe com dois espaços entre campos,
    // destinatários e advogados em ordem alfabética (o ente vem antes).
    const pubs = [
      item({
        data: '2025-03-10',
        texto:
          'PODER JUDICIÁRIO  JUSTIÇA DO TRABALHO  1ª VARA DO TRABALHO DE MACEIÓ  CumSen 0000111-11.2023.5.19.0001  EXEQUENTE: ZULMIRA EXEMPLO DOS SANTOS  ADVOGADO: XAVIER CREDORIO MACHADO  EXECUTADO: ESTADO DE ALAGOAS  ADVOGADO: ALBERTO PROCURADOR EXEMPLO  INTIMAÇÃO  Fica V. Sa. intimado. Expeça-se o ofício precatório requisitório.',
        destinatarios: [
          ['ESTADO DE ALAGOAS', 'A'],
          ['ZULMIRA EXEMPLO DOS SANTOS', 'A'],
        ],
        advogados: [
          { id: 1, nome: 'ALBERTO PROCURADOR EXEMPLO', oab: '1111' },
          { id: 2, nome: 'XAVIER CREDORIO MACHADO', oab: '2222' },
        ],
      }),
    ].map(mapCruParaPublicacao);

    const consolidado = consolidarProcesso(pubs);
    const l = linha({
      cedente_nome_provavel: 'ESTADO DE ALAGOAS',
      advogado_nome: 'ALBERTO PROCURADOR EXEMPLO',
      advogado_oab: '1111/AL',
      red_flags: ['4'],
    });
    // O mesmo procurador aparece do lado do Estado em outro processo do lote
    // (é assim nos dados reais): com 2 processos o recálculo apaga/troca.
    const consolidados = new Map([
      [CNJ_A, { ...consolidado, advogadosCitados: [] }],
      [CNJ_B, { ...consolidado, advogadosCitados: [] }],
    ]);
    const diffs = calcularDiffs([l], consolidados);

    expect(diffs.map((d) => [d.campo, d.tipo, d.depois])).toEqual([
      ['credor', 'corrigir', 'ZULMIRA EXEMPLO DOS SANTOS'],
      ['advogado', 'corrigir', 'XAVIER CREDORIO MACHADO · OAB 2222/AL'],
      ['red_flags', 'corrigir', consolidado.redFlags.join(', ') || null],
    ]);
    expect(diffs.find((d) => d.campo === 'red_flags')!.motivo).toMatch(/Sai: 4/);
  });
});
