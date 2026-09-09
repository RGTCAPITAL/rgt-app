import { describe, expect, it } from 'vitest';
import { extrairRedFlags } from './red-flags';
import { extrairMetadadosProspeccao } from './extract';
import type { ProcessoJudit } from './types';

/**
 * Estes testes existem porque a Judit ainda não foi contratada: o formato real
 * da resposta é uma suposição. Quando a API entrar e o schema divergir, o que
 * quebra aqui é o alerta — sem isso, a fila de prospecção encheria de linhas
 * "enriquecidas" com tudo nulo e ninguém perceberia.
 *
 * Os casos de drift (autor capitalizado, campo aninhado diferente) estão
 * marcados como comportamento ATUAL, não como comportamento desejado.
 */

const processoBase: ProcessoJudit = {
  numero_cnj: '00011073320175190001',
  transitou_em_julgado: true,
  data_ultimo_movimento: new Date().toISOString(),
  partes: [
    {
      tipo: 'autor',
      nome: 'João da Silva',
      cpf_cnpj: '12345678901',
      advogados: [{ nome: 'Dra. Ana Costa', oab: 'AL 12345' }],
    },
    { tipo: 'reu', nome: 'Estado de Alagoas' },
  ],
};

describe('extrairRedFlags', () => {
  it('processo saudável não gera flag', () => {
    expect(extrairRedFlags(processoBase)).toEqual([]);
  });

  it('payload vazio vira nao_encontrado', () => {
    expect(extrairRedFlags({})).toEqual(['nao_encontrado']);
  });

  it('payload sem numero_cnj vira nao_encontrado', () => {
    expect(extrairRedFlags({ algo: 'inesperado' })).toEqual(['nao_encontrado']);
  });

  it('acusa quando não transitou em julgado', () => {
    expect(extrairRedFlags({ ...processoBase, transitou_em_julgado: false })).toContain(
      'nao_transitou',
    );
  });

  it('NÃO acusa quando transitou_em_julgado está ausente', () => {
    // Ausente é diferente de false: sem o dado não dá pra afirmar que não transitou
    const { transitou_em_julgado: _, ...semCampo } = processoBase;
    expect(extrairRedFlags(semCampo)).not.toContain('nao_transitou');
  });

  it('acusa penhora ativa', () => {
    expect(
      extrairRedFlags({
        ...processoBase,
        penhoras: [{ valor: 5000, descricao: 'Penhora BacenJud' }],
      }),
    ).toContain('tem_penhora');
  });

  it('acusa cessão anterior a outro cessionário', () => {
    expect(
      extrairRedFlags({ ...processoBase, cessoes: [{ cessionario_nome: 'Fundo XYZ' }] }),
    ).toContain('outro_cessionario');
  });

  it('acusa autor sem advogado', () => {
    const semAdvogado: ProcessoJudit = {
      ...processoBase,
      partes: [{ tipo: 'autor', nome: 'João da Silva', advogados: [] }],
    };
    expect(extrairRedFlags(semAdvogado)).toContain('sem_advogado');
  });

  it('acusa processo parado há mais de 6 meses', () => {
    const oitoMesesAtras = new Date(Date.now() - 240 * 86400000).toISOString();
    expect(extrairRedFlags({ ...processoBase, data_ultimo_movimento: oitoMesesAtras })).toContain(
      'sem_movimentacao_recente',
    );
  });

  it('não acusa parado quando a movimentação é recente', () => {
    const umMesAtras = new Date(Date.now() - 30 * 86400000).toISOString();
    expect(extrairRedFlags({ ...processoBase, data_ultimo_movimento: umMesAtras })).not.toContain(
      'sem_movimentacao_recente',
    );
  });

  it('acumula várias flags no mesmo processo', () => {
    const ruim: ProcessoJudit = {
      ...processoBase,
      transitou_em_julgado: false,
      penhoras: [{ valor: 1000 }],
      cessoes: [{ cessionario_nome: 'Outro' }],
    };
    const flags = extrairRedFlags(ruim);
    expect(flags).toContain('nao_transitou');
    expect(flags).toContain('tem_penhora');
    expect(flags).toContain('outro_cessionario');
  });

  // ─── Drift de schema: comportamento ATUAL, não o desejado ──────────────────

  it('DRIFT: tipo de parte capitalizado passa despercebido', () => {
    // A Judit pode devolver 'Autor' em vez de 'autor'. Hoje o find falha e
    // sem_advogado nunca dispara — mesmo num processo realmente sem advogado.
    const capitalizado = {
      ...processoBase,
      partes: [{ tipo: 'Autor', nome: 'João da Silva', advogados: [] }],
    } as ProcessoJudit;
    expect(extrairRedFlags(capitalizado)).not.toContain('sem_advogado');
  });

  it('DRIFT: numero_cnj nulo é tratado como processo válido', () => {
    // Se a Judit devolver { numero_cnj: null, _judit: {...} } pra processo não
    // encontrado, isProcesso passa e nao_encontrado NÃO é emitido — o broker
    // veria a linha como limpa.
    const semCnj = { numero_cnj: null, _judit: { fonte: 'x' } } as unknown as ProcessoJudit;
    expect(extrairRedFlags(semCnj)).not.toContain('nao_encontrado');
  });

  it("'regime_especial' existe no tipo mas nunca é emitido", () => {
    // Lacuna conhecida: a flag está no union RedFlag mas nenhuma heurística a
    // produz. O dado de regime especial vem de entes_devedores, não da Judit.
    const todasAsFlags = [
      extrairRedFlags({}),
      extrairRedFlags(processoBase),
      extrairRedFlags({ ...processoBase, transitou_em_julgado: false }),
    ].flat();
    expect(todasAsFlags).not.toContain('regime_especial');
  });
});

describe('extrairMetadadosProspeccao', () => {
  it('extrai credor, CPF, advogado e OAB', () => {
    expect(extrairMetadadosProspeccao(processoBase)).toEqual({
      cedenteNome: 'João da Silva',
      cedenteCpf: '12345678901',
      advogadoNome: 'Dra. Ana Costa',
      advogadoOab: 'AL 12345',
    });
  });

  it('devolve tudo nulo quando o payload não é processo', () => {
    expect(extrairMetadadosProspeccao({ erro: 'timeout' })).toEqual({
      cedenteNome: null,
      cedenteCpf: null,
      advogadoNome: null,
      advogadoOab: null,
    });
  });

  it('devolve tudo nulo quando não há parte autora', () => {
    const semAutor: ProcessoJudit = {
      ...processoBase,
      partes: [{ tipo: 'reu', nome: 'Estado de Alagoas' }],
    };
    expect(extrairMetadadosProspeccao(semAutor).cedenteNome).toBeNull();
  });

  it('extrai o credor mesmo sem advogado cadastrado', () => {
    const semAdvogado: ProcessoJudit = {
      ...processoBase,
      partes: [{ tipo: 'autor', nome: 'Maria Souza', cpf_cnpj: '98765432100' }],
    };
    const meta = extrairMetadadosProspeccao(semAdvogado);
    expect(meta.cedenteNome).toBe('Maria Souza');
    expect(meta.advogadoNome).toBeNull();
  });

  it('pega o primeiro advogado quando há vários', () => {
    const varios: ProcessoJudit = {
      ...processoBase,
      partes: [
        {
          tipo: 'autor',
          nome: 'João da Silva',
          advogados: [
            { nome: 'Primeiro', oab: 'AL 1' },
            { nome: 'Segundo', oab: 'AL 2' },
          ],
        },
      ],
    };
    expect(extrairMetadadosProspeccao(varios).advogadoNome).toBe('Primeiro');
  });

  it('DRIFT: string bruta (HTML de erro) não quebra, devolve nulos', () => {
    // Se um proxy da Judit responder 200 com HTML, fetchJson devolve a string.
    // O importante é não explodir — mas repare que o batch marcaria isso como
    // 'ok' com todos os campos vazios.
    const html = '<html><body>Manutenção</body></html>' as unknown as ProcessoJudit;
    expect(extrairMetadadosProspeccao(html).cedenteNome).toBeNull();
  });
});
