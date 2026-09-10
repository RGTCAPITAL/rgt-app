import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extrairOficio } from './extrair-oficio';
import { montarRevisao, type EnteOpcao } from './resolver';

/**
 * Teste de ponta a ponta da leitura do ofício. Gasta dinheiro: faz uma chamada
 * real na API por execução.
 *
 * Só roda quando as duas variáveis estão presentes:
 *   ANTHROPIC_API_KEY   — a chave
 *   OFICIO_TESTE_PDF    — caminho de um PDF de ofício requisitório
 *
 * Sem elas o suite é pulado, então `npm test` continua de graça no dia a dia.
 * Aponte o OFICIO_TESTE_PDF pra um ofício de verdade quando quiser medir a
 * qualidade da extração contra um documento que você já conferiu na mão.
 */

const chave = process.env.ANTHROPIC_API_KEY;
const caminhoPdf = process.env.OFICIO_TESTE_PDF;
const rodar = Boolean(chave && caminhoPdf);

const ENTES: EnteOpcao[] = [
  { id: 'ente-uniao', nome: 'União', esfera: 'federal' },
  { id: 'ente-al', nome: 'Estado de Alagoas', esfera: 'estadual' },
  { id: 'ente-maceio', nome: 'Município de Maceió', esfera: 'municipal' },
];

describe.skipIf(!rodar)('extração real do ofício (custa uma chamada de API)', () => {
  it('lê o PDF e devolve campos aplicáveis no formulário', async () => {
    const pdf = readFileSync(caminhoPdf as string);
    const { extracao, tokensEntrada, tokensSaida } = await extrairOficio(pdf, 'application/pdf');

    expect(extracao.documento_reconhecido).toBe(true);

    const revisao = montarRevisao(extracao, ENTES);
    expect(revisao.campos.length).toBeGreaterThan(0);

    // Todo campo aplicável tem que vir com prova de origem. Sem trecho, o
    // revisor não tem como conferir sem reabrir o PDF — e o valor vira fé.
    for (const c of revisao.campos) {
      if (c.id === 'tribunal' || c.id === 'ente_devedor_id') continue;
      expect(c.trecho, `campo ${c.id} veio sem trecho de origem`).toBeTruthy();
    }

    console.log(
      `[extração] ${revisao.campos.length} campos · ${tokensEntrada} tokens in / ${tokensSaida} out`,
    );
    console.table(
      revisao.campos.map((c) => ({
        campo: c.id,
        valor: c.valorExibido,
        confianca: c.confianca,
        trecho: c.trecho?.slice(0, 50) ?? '',
      })),
    );
  });
});
