import { describe, expect, it } from 'vitest';
import {
  GRUPO_TEXTO,
  GRUPOS_EM_ORDEM,
  ORDEM_GRUPO,
  STATUS_NA_FILA,
  grupoFila,
  ordenarParaFila,
  proximoPasso,
  resolverVisao,
  resumoGrupos,
} from './fila';

// Nomes fictícios: o repo é público. O formato imita o que o batch grava.
type Linha = {
  id: string;
  red_flags: string[];
  valor_face: number | null;
  cedente_nome_provavel: string | null;
  advogado_nome: string | null;
  judit_status: string;
};

function linha(id: string, red_flags: string[], extra: Partial<Linha> = {}): Linha {
  return {
    id,
    red_flags,
    valor_face: 100_000,
    cedente_nome_provavel: 'FULANO DE TAL DA SILVA',
    advogado_nome: 'BELTRANO SOUZA',
    judit_status: 'ok',
    ...extra,
  };
}

describe('STATUS_NA_FILA', () => {
  it('só os status que ainda pedem ação do broker', () => {
    expect([...STATUS_NA_FILA]).toEqual(['importado', 'enriquecido', 'em_prospeccao']);
    expect(STATUS_NA_FILA).not.toContain('lead_criado');
    expect(STATUS_NA_FILA).not.toContain('descartado');
  });
});

describe('resolverVisao', () => {
  it('parâmetro explícito vale pra qualquer perfil', () => {
    expect(resolverVisao('fila', 'admin')).toBe('fila');
    expect(resolverVisao('todos', 'broker')).toBe('todos');
    expect(resolverVisao('fila', undefined)).toBe('fila');
    expect(resolverVisao('todos', undefined)).toBe('todos');
  });

  it('sem parâmetro: broker cai na fila, o resto em todos', () => {
    expect(resolverVisao(undefined, 'broker')).toBe('fila');
    expect(resolverVisao(undefined, 'admin')).toBe('todos');
    expect(resolverVisao(undefined, 'gestao')).toBe('todos');
    expect(resolverVisao(undefined, undefined)).toBe('todos');
  });

  it('valor desconhecido na URL é tratado como ausente', () => {
    expect(resolverVisao('qualquer', 'broker')).toBe('fila');
    expect(resolverVisao('', 'broker')).toBe('fila');
    expect(resolverVisao('FILA', 'admin')).toBe('todos');
  });
});

describe('grupoFila', () => {
  it('alerta grave vai pra conferir, mesmo com ofício citado', () => {
    expect(grupoFila({ red_flags: ['X1', '1c'] })).toBe('conferir');
    expect(grupoFila({ red_flags: ['4'] })).toBe('conferir');
    expect(grupoFila({ red_flags: ['8', 'X1'] })).toBe('conferir');
  });

  it('X1 sem alerta grave vai pra oficio', () => {
    expect(grupoFila({ red_flags: ['X1'] })).toBe('oficio');
    expect(grupoFila({ red_flags: ['9', 'X1', '4e', 'X7'] })).toBe('oficio');
  });

  it('sem X1 e sem alerta grave vai pra outros', () => {
    expect(grupoFila({ red_flags: [] })).toBe('outros');
    expect(grupoFila({ red_flags: ['10', '7', '4e'] })).toBe('outros');
    // X7 é boilerplate do art. 100 §14, não é grave
    expect(grupoFila({ red_flags: ['X7'] })).toBe('outros');
  });
});

describe('ORDEM_GRUPO / GRUPOS_EM_ORDEM / GRUPO_TEXTO', () => {
  it('oficio, outros, conferir', () => {
    expect(ORDEM_GRUPO).toEqual({ oficio: 0, outros: 1, conferir: 2 });
    expect(GRUPOS_EM_ORDEM).toEqual(['oficio', 'outros', 'conferir']);
  });

  it('textos dos blocos', () => {
    expect(GRUPO_TEXTO.oficio).toEqual({
      titulo: 'Ofício citado no DJEN',
      subtitulo: 'Sem alerta grave. Comece por aqui, do maior valor pro menor.',
    });
    expect(GRUPO_TEXTO.outros).toEqual({
      titulo: 'Outros precatórios sem alerta grave',
      subtitulo:
        'Também estão na planilha do tribunal; o DJEN só não citou o ofício nas publicações recentes.',
    });
    expect(GRUPO_TEXTO.conferir).toEqual({
      titulo: 'Conferir antes de ligar',
      subtitulo:
        'Provável cessão, FIDC, penhora ou pagamento. Abra o processo no PJe e veja quanto ainda é do credor antes de qualquer contato.',
    });
  });
});

describe('ordenarParaFila', () => {
  it('agrupa por bloco e preserva a ordem recebida dentro de cada um', () => {
    // Chega por valor desc do servidor, grupos misturados.
    const rows = [
      linha('a', [], { valor_face: 900 }),
      linha('b', ['X4', '7'], { valor_face: 800 }),
      linha('c', ['1c', 'X1'], { valor_face: 700 }),
      linha('d', ['X1'], { valor_face: 600 }),
      linha('e', ['10'], { valor_face: 500 }),
      linha('f', ['X1', '9'], { valor_face: 400 }),
      linha('g', ['2'], { valor_face: 300 }),
      linha('h', ['X1'], { valor_face: 200 }),
    ];
    expect(ordenarParaFila(rows).map((r) => r.id)).toEqual([
      'd',
      'f',
      'h',
      'a',
      'b',
      'e',
      'c',
      'g',
    ]);
  });

  it('é estável mesmo quando a entrada não está ordenada por valor', () => {
    // Prova que a função não reordena por valor por conta própria.
    const rows = [
      linha('p', ['X1'], { valor_face: 10 }),
      linha('q', ['X1'], { valor_face: 999 }),
      linha('r', ['X1'], { valor_face: 500 }),
    ];
    expect(ordenarParaFila(rows).map((r) => r.id)).toEqual(['p', 'q', 'r']);
  });

  it('não muta a entrada e devolve os mesmos objetos', () => {
    const rows = [linha('a', ['4']), linha('b', ['X1'])];
    const copia = [...rows];
    const out = ordenarParaFila(rows);
    expect(rows).toEqual(copia);
    expect(out).not.toBe(rows);
    expect(out[0]).toBe(rows[1]);
    expect(out[1]).toBe(rows[0]);
  });

  it('lista vazia devolve lista vazia', () => {
    expect(ordenarParaFila([])).toEqual([]);
  });
});

describe('resumoGrupos', () => {
  it('conta e soma por bloco', () => {
    const rows = [
      linha('a', ['X1'], { valor_face: 1000 }),
      linha('b', ['X1', '9'], { valor_face: 250.5 }),
      linha('c', [], { valor_face: 300 }),
      linha('d', ['1', 'X1'], { valor_face: 5000 }),
    ];
    expect(resumoGrupos(rows)).toEqual({
      oficio: { qtd: 2, soma: 1250.5 },
      outros: { qtd: 1, soma: 300 },
      conferir: { qtd: 1, soma: 5000 },
    });
  });

  it('valor nulo conta na quantidade mas soma zero', () => {
    const rows = [linha('a', [], { valor_face: null }), linha('b', [], { valor_face: 700 })];
    expect(resumoGrupos(rows).outros).toEqual({ qtd: 2, soma: 700 });
  });

  it('os três grupos sempre vêm, mesmo vazios', () => {
    expect(resumoGrupos([])).toEqual({
      oficio: { qtd: 0, soma: 0 },
      outros: { qtd: 0, soma: 0 },
      conferir: { qtd: 0, soma: 0 },
    });
  });
});

describe('proximoPasso', () => {
  const GRAVE = 'Veja no PJe quanto ainda é do credor antes de ligar.';
  const ESPOLIO = 'Espólio: procure o inventariante ou os herdeiros habilitados.';
  const SEM_CREDOR = 'Procure no PJe quem é o credor ou o advogado dele.';
  const EXTINCAO = 'Leia no PJe a decisão de extinção antes de ligar.';

  it('linha comum não ganha frase', () => {
    expect(proximoPasso(linha('a', ['X1', '9']))).toBeNull();
    expect(proximoPasso(linha('a', []))).toBeNull();
  });

  it('alerta grave vence tudo', () => {
    expect(
      proximoPasso(
        linha('a', ['1c', '7', '4e'], {
          cedente_nome_provavel: null,
          judit_status: 'ok',
        }),
      ),
    ).toBe(GRAVE);
    expect(proximoPasso(linha('a', ['4']))).toBe(GRAVE);
  });

  it('espólio pela flag 7', () => {
    expect(proximoPasso(linha('a', ['X1', '7']))).toBe(ESPOLIO);
  });

  it('espólio pelo sufixo do nome', () => {
    expect(
      proximoPasso(linha('a', [], { cedente_nome_provavel: 'CICLANO PEREIRA (ESPÓLIO)' })),
    ).toBe(ESPOLIO);
    // Variações: sem acento, caixa baixa, espaço sobrando, forma do cabeçalho PJe
    expect(
      proximoPasso(linha('a', [], { cedente_nome_provavel: 'Ciclano Pereira (espolio) ' })),
    ).toBe(ESPOLIO);
    expect(
      proximoPasso(linha('a', [], { cedente_nome_provavel: 'CICLANO PEREIRA (ESPÓLIO DE)' })),
    ).toBe(ESPOLIO);
  });

  it('"espólio" no meio do nome não conta', () => {
    expect(
      proximoPasso(
        linha('a', [], { cedente_nome_provavel: 'CICLANO PEREIRA (ESPÓLIO DE) E OUTROS (3)' }),
      ),
    ).toBeNull();
  });

  it('espólio vem antes de credor não identificado e de extinção', () => {
    expect(
      proximoPasso(linha('a', ['7', '4e'], { cedente_nome_provavel: null, judit_status: 'ok' })),
    ).toBe(ESPOLIO);
  });

  it('DJEN ok sem credor manda falar com o advogado', () => {
    expect(proximoPasso(linha('a', ['X1'], { cedente_nome_provavel: null }))).toBe(SEM_CREDOR);
    // String vazia ou só espaço também é "sem credor"
    expect(proximoPasso(linha('a', [], { cedente_nome_provavel: '   ' }))).toBe(SEM_CREDOR);
    // Não depende de ter advogado na linha
    expect(proximoPasso(linha('a', [], { cedente_nome_provavel: null, advogado_nome: null }))).toBe(
      SEM_CREDOR,
    );
  });

  it('sem credor só conta quando o DJEN achou publicação', () => {
    for (const status of ['pendente', 'not_found', 'error']) {
      expect(
        proximoPasso(linha('a', [], { cedente_nome_provavel: null, judit_status: status })),
      ).toBeNull();
    }
  });

  it('credor não identificado vem antes da extinção', () => {
    expect(proximoPasso(linha('a', ['4e'], { cedente_nome_provavel: null }))).toBe(SEM_CREDOR);
  });

  it('extinção citada (4e) pede leitura da publicação', () => {
    expect(proximoPasso(linha('a', ['X1', '4e', '5']))).toBe(EXTINCAO);
    // A regra da extinção não olha o judit_status
    expect(
      proximoPasso(linha('a', ['4e'], { cedente_nome_provavel: null, judit_status: 'pendente' })),
    ).toBe(EXTINCAO);
  });
});
