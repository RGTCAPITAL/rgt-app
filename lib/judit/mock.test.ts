import { describe, expect, it } from 'vitest';
import { cenarioDoCnj, processoSimulado, modoMockLigado } from './mock';
import { extrairRedFlags } from './red-flags';
import { extrairMetadadosProspeccao } from './extract';

const CNJ = '00011073320175190001';

describe('mock da Judit', () => {
  it('é determinístico: o mesmo CNJ dá sempre o mesmo cenário', () => {
    const primeiro = cenarioDoCnj(CNJ);
    for (let i = 0; i < 20; i++) expect(cenarioDoCnj(CNJ)).toBe(primeiro);
  });

  it('CNJs diferentes caem em cenários diferentes', () => {
    const cenarios = new Set(
      Array.from({ length: 200 }, (_, i) =>
        cenarioDoCnj(String(10000000000000000000n + BigInt(i))),
      ),
    );
    // Sem variedade, a fila inteira ficaria com o mesmo resultado e não daria
    // pra testar filtro nenhum.
    expect(cenarios.size).toBeGreaterThan(3);
  });

  it('a distribuição deixa a maioria dos processos limpa', () => {
    const amostra = Array.from({ length: 1000 }, (_, i) =>
      cenarioDoCnj(String(20000000000000000000n + BigInt(i))),
    );
    const saudaveis = amostra.filter((c) => c === 'saudavel').length;
    // Se a maioria tivesse red flag, o broker aprenderia a ignorar o alerta.
    expect(saudaveis).toBeGreaterThan(400);
    expect(saudaveis).toBeLessThan(700);
  });

  it('todo credor simulado é marcado como tal', () => {
    for (let i = 0; i < 50; i++) {
      const p = processoSimulado(String(30000000000000000000n + BigInt(i)));
      const autor = p.partes?.find((x) => x.tipo === 'autor');
      expect(autor?.nome).toMatch(/^\[SIMULADO\]/);
    }
  });

  it('o payload alimenta o extrator de metadados de verdade', () => {
    const meta = extrairMetadadosProspeccao(processoSimulado(CNJ));
    expect(meta.cedenteNome).toBeTruthy();
    expect(meta.cedenteCpf).toMatch(/^\d+$/);
  });

  it('cada cenário produz a red flag que promete', () => {
    // Varre CNJs até achar um de cada cenário e confere que a heurística real
    // enxerga o que o mock quis simular — se os dois saírem de sincronia, a
    // fila mostraria flags que não correspondem ao payload.
    const casos: Record<string, string> = {
      com_penhora: 'tem_penhora',
      nao_transitou: 'nao_transitou',
      ja_cedido: 'outro_cessionario',
      sem_advogado: 'sem_advogado',
      parado: 'sem_movimentacao_recente',
    };
    const vistos = new Set<string>();

    for (let i = 0; i < 3000 && vistos.size < Object.keys(casos).length; i++) {
      const cnj = String(40000000000000000000n + BigInt(i));
      const cenario = cenarioDoCnj(cnj);
      const esperada = casos[cenario];
      if (!esperada || vistos.has(cenario)) continue;
      expect(extrairRedFlags(processoSimulado(cnj)), `cenário ${cenario}`).toContain(esperada);
      vistos.add(cenario);
    }
    expect(vistos.size, `cenários não exercitados: ${vistos.size}`).toBe(Object.keys(casos).length);
  });

  it('processo saudável não gera red flag', () => {
    for (let i = 0; i < 2000; i++) {
      const cnj = String(50000000000000000000n + BigInt(i));
      if (cenarioDoCnj(cnj) !== 'saudavel') continue;
      expect(extrairRedFlags(processoSimulado(cnj))).toEqual([]);
      return;
    }
    throw new Error('nenhum caso saudável na amostra');
  });

  it('só liga com JUDIT_MODO=mock explícito', () => {
    // Nunca por acidente: sem a variável, o modo simulado fica desligado.
    expect(modoMockLigado()).toBe(process.env.JUDIT_MODO === 'mock');
  });
});
