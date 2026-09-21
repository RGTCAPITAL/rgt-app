/**
 * Teste de integração contra a API pública do DJEN.
 *
 * Roda em CI e local. Skipa quando não há rede (offline, firewall). Não gasta
 * dinheiro — DJEN é gratuito, sem chave. O que pode "custar" é rate limit:
 * cada teste faz 1 chamada + espera 3.3s no rate limiter serial.
 */

import { describe, expect, it } from 'vitest';
import { buscarPorCnj, consultarPagina } from './client';
import { DjenValidacaoError } from './types';

const RODAR = process.env.DJEN_LIVE !== 'off';

describe.skipIf(!RODAR)('DJEN — API viva', () => {
  it('busca por CNJ real (planilha TRT19) devolve publicações', async () => {
    // CNJ da planilha do TRT19 usado no teste dos 128 em setembro
    const pubs = await buscarPorCnj('0001107-33.2017.5.19.0001', { limite: 5 });
    expect(pubs.length).toBeGreaterThan(0);
    expect(pubs[0].siglaTribunal).toBe('TRT19');
    // 20 dígitos sem máscara na resposta
    expect(pubs[0].processo.cnj).toMatch(/^\d{20}$/);
  }, 30_000);

  it('consulta 1 página do TJAL em uma data recente e conta', async () => {
    // Data que sabemos ter volume no TJAL — evita falha por dia sem publicação
    const resp = await consultarPagina({
      siglaTribunal: 'TJAL',
      dataDisponibilizacaoInicio: '2026-01-20',
      dataDisponibilizacaoFim: '2026-01-20',
      itensPorPagina: 5,
      pagina: 1,
    });
    expect(resp.count).toBeGreaterThan(0);
    expect(resp.publicacoes.length).toBeLessThanOrEqual(5);
    // Rate limit header deveria vir
    expect(resp.rateLimitRemaining).not.toBeNull();
  }, 30_000);

  it('CNJ inexistente devolve array vazio (não é erro)', async () => {
    const pubs = await buscarPorCnj('00000000000000000000');
    expect(pubs).toEqual([]);
  }, 30_000);
});

describe('DJEN — validação client-side', () => {
  it('rejeita CNJ com dígitos errados sem chegar na rede', async () => {
    await expect(buscarPorCnj('123')).rejects.toThrow(DjenValidacaoError);
  });

  it('rejeita OAB sem UF', async () => {
    await expect(consultarPagina({ numeroOab: '12345' })).rejects.toThrow(DjenValidacaoError);
  });

  it('rejeita data em formato dd/mm/yyyy', async () => {
    await expect(consultarPagina({ dataDisponibilizacaoInicio: '20/01/2026' })).rejects.toThrow(
      DjenValidacaoError,
    );
  });

  it('rejeita pagina < 1', async () => {
    await expect(consultarPagina({ pagina: 0 })).rejects.toThrow(DjenValidacaoError);
  });
});
