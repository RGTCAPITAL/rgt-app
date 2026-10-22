/**
 * Teste de integração da busca por nome contra a API pública do DJEN.
 *
 * Os casos são os três nomes que o Renato mandou por WhatsApp em 2026-10-22
 * (RGT-95), e cada um existe aqui porque falhou de um jeito diferente no
 * levantamento manual. Se a API mudar o comportamento de `nomeParte`, ou se
 * alguém afrouxar a triagem por devedor, isto quebra.
 *
 * Gratuito (DJEN não tem chave nem cobrança). O custo é tempo: rate limiter
 * serial a 3,3 s por requisição, e cada busca varre os tribunais pedidos.
 */

import { describe, expect, it } from 'vitest';
import { buscarPorNome } from './busca-por-nome';

const RODAR = process.env.DJEN_LIVE !== 'off';

describe.skipIf(!RODAR)('busca por nome — DJEN vivo', () => {
  it('acha o processo da Waldiria contra o Estado de Alagoas e põe na frente', async () => {
    // Só no TJAL: no TRT19 ela tem reclamação trabalhista em fase de
    // conhecimento, e quem varre um tribunal só conclui que não há nada.
    const r = await buscarPorNome('Waldiria', { tribunais: ['TJAL'] });

    const estado = r.processos.find((p) => p.cnj === '07077053720248020001');
    expect(estado, 'processo contra o Estado de Alagoas sumiu').toBeDefined();
    expect(estado!.classe).toBe('estadual');
    expect(estado!.comprado).toBe(true);
    expect(estado!.devedores.map((d) => d.nome).join(' ')).toMatch(/ESTADO DE ALAGOAS/i);

    // Devedor público vem antes de banco: a ordenação é o produto.
    const posEstado = r.processos.findIndex((p) => p.comprado);
    expect(r.processos[posEstado].cnj).toBe('07077053720248020001');
  }, 120_000);

  it('nome abreviado não acha — é o erro que parece "a pessoa não tem processo"', async () => {
    // Foi exatamente o que o Renato mandou. Nos autos é WALDIRIA MARIA
    // SIQUEIRA AYRES: o "S" abreviado e o Aires/Ayres zeram a busca.
    const r = await buscarPorNome('Waldiria Maria S Aires', { tribunais: ['TJAL'] });
    expect(r.processos).toHaveLength(0);
    expect(r.avisos.join(' ')).toMatch(/casa o nome literalmente/i);
  }, 120_000);

  it('os 9 processos da Maria Antonia no TRT19 são todos de devedor privado', async () => {
    // O caso que justifica a feature: nome comum, muitos processos, nenhum
    // que possa virar precatório. Se um dia aparecer devedor público aqui,
    // é mudança real no mundo — vale olhar, não só consertar o teste.
    const r = await buscarPorNome('Maria Antonia dos Santos', { tribunais: ['TRT19'] });

    expect(r.processos.length).toBeGreaterThanOrEqual(5);
    expect(r.comprados).toBe(0);
    expect(r.avisos.join(' ')).toMatch(/nenhum dos \d+ processos tem devedor público/i);
  }, 120_000);

  it('acha a Maria Sofia contra a União pelo nome incompleto', async () => {
    // Renato mandou "Maria Sofia de Oliveira"; nos autos tem "SANTOS" no
    // fim. Casamento por substring resolve — e o devedor é federal.
    const r = await buscarPorNome('Maria Sofia de Oliveira', { tribunais: ['TRT19'] });

    const uniao = r.processos.find((p) => p.classe === 'federal');
    expect(uniao, 'processo contra a União sumiu').toBeDefined();
    expect(uniao!.comprado).toBe(true);
    expect(uniao!.nosAutos.join(' ')).toMatch(/MARIA SOFIA DE OLIVEIRA SANTOS/i);
  }, 120_000);
});
