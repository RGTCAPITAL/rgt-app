import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { extracaoOficioSchema, type ExtracaoOficio } from './schema';
import { getCliente, IAError, MODELO_EXTRACAO, TAMANHO_MAX_BYTES } from './client';

const PROMPT_SISTEMA = `Você lê ofícios requisitórios brasileiros (precatórios e RPVs) e extrai os dados para cadastro.

Regras:

1. **Só transcreva o que está escrito.** Este documento vira uma operação financeira real. Um valor errado custa dinheiro. Se o campo não está no documento, devolva null — nunca preencha por dedução plausível.
2. **Todo campo preenchido precisa de \`trecho\`**, que é a citação literal do documento de onde o valor saiu, copiada caractere por caractere. Se você não consegue citar, o valor é null.
3. **Confiança**: \`alta\` quando o dado está escrito com todas as letras e rotulado; \`media\` quando é dedução segura (ex: natureza alimentar porque o documento diz "verba salarial"); \`baixa\` quando é inferência de contexto.
4. **Valores monetários**: só o número, com ponto decimal e sem separador de milhar nem "R$". "R$ 125.430,55" vira "125430.55".
5. **Datas**: sempre yyyy-mm-dd.
6. **Não some valores.** Se o documento traz um total mas não separa principal de juros, preencha só o que está discriminado e deixe o resto null. Somar ou subtrair por conta própria é o erro mais caro possível aqui.
7. Se o arquivo não for um ofício requisitório, marque \`documento_reconhecido: false\` e devolva null em todos os campos.

Vocabulário do domínio:
- **Cedente** é o beneficiário/credor do precatório — a pessoa que vai ceder o crédito. Não é o advogado nem o ente devedor.
- **Data-base** é a data a que o cálculo se refere ("valores atualizados até…"), não a data de emissão do ofício.
- **Ente devedor** é quem paga: União, estado, município, autarquia, INSS, empresa pública.
- **PSS** é a retenção previdenciária; **RRA** é o regime de rendimentos acumulados, contado em meses.
- **LOA** é o ano do orçamento em que o precatório entra pra pagamento.

## Campos

Devolva **só os que você encontrou**. Use exatamente estes nomes; omita o resto.

| campo | o que é | formato |
|---|---|---|
| \`cedente_nome\` | nome completo do beneficiário/credor | texto |
| \`cedente_cpf\` | CPF do beneficiário | só dígitos |
| \`numero_processo\` | número do processo no padrão CNJ | 20 dígitos |
| \`tipo\` | natureza do requisitório | \`precatorio\`, \`rpv\`, \`pre_precatorio\`, \`pre_rpv\` ou \`direito_creditorio\` |
| \`natureza\` | natureza do crédito | \`alimentar\`, \`comum\` ou \`tributaria\` — verba salarial, previdenciária, honorários e indenização trabalhista são alimentar |
| \`especie\` | de quem é o crédito | \`credito_total\` (principal + honorários juntos), \`apenas_principal\` (só o beneficiário) ou \`honorarios\` (só o advogado) |
| \`ente_devedor\` | quem paga | nome como escrito no documento |
| \`tribunal_sigla\` | tribunal do processo | sigla: TRT19, TJAL, TRF5, STJ… |
| \`data_base\` | data a que os valores se referem | yyyy-mm-dd |
| \`data_autuacao\` | autuação/distribuição do processo | yyyy-mm-dd |
| \`loa\` | ano do orçamento de pagamento | 4 dígitos |
| \`valor_principal\` | valor principal do crédito | 125430.55 |
| \`valor_juros\` | juros moratórios | 125430.55 |
| \`valor_selic\` | atualização Selic, se destacada à parte | 125430.55 |
| \`retencao_honorarios_pct\` | honorários contratuais destacados do crédito | só o número: 20 |
| \`pss_pct\` | percentual de PSS retido | só o número: 11 |
| \`rra_meses\` | meses do RRA | inteiro |`;

export type ResultadoExtracao = {
  extracao: ExtracaoOficio;
  tokensEntrada: number;
  tokensSaida: number;
};

/**
 * Manda o PDF direto pra API — sem parser local.
 *
 * A Messages API aceita PDF nativo como content block `document`, e o modelo
 * enxerga as páginas. Isso resolve o caso que quebraria qualquer extração por
 * texto: ofício digitalizado, que é imagem e não tem camada de texto nenhuma.
 */
export async function extrairOficio(
  arquivo: Buffer,
  mediaType: 'application/pdf',
): Promise<ResultadoExtracao> {
  if (arquivo.byteLength > TAMANHO_MAX_BYTES) {
    throw new IAError(
      `Arquivo tem ${(arquivo.byteLength / 1024 / 1024).toFixed(1)}MB. O limite é ${TAMANHO_MAX_BYTES / 1024 / 1024}MB.`,
    );
  }

  const cliente = getCliente();

  try {
    const resposta = await cliente.messages.parse({
      model: MODELO_EXTRACAO,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: PROMPT_SISTEMA,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: arquivo.toString('base64'),
              },
            },
            {
              type: 'text',
              text: 'Extraia os dados deste ofício requisitório para cadastro da operação.',
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(extracaoOficioSchema) },
    });

    if (resposta.stop_reason === 'refusal') {
      throw new IAError('A IA recusou processar este documento.');
    }

    // parsed_output vem null quando o modelo estourou max_tokens no meio do
    // JSON. Nesse caso não dá pra aproveitar nada — melhor falhar explícito do
    // que devolver metade dos campos.
    if (!resposta.parsed_output) {
      throw new IAError(
        resposta.stop_reason === 'max_tokens'
          ? 'A resposta da IA foi truncada. Tente com um arquivo menor ou só as páginas do ofício.'
          : 'A IA não devolveu os dados no formato esperado.',
      );
    }

    return {
      extracao: resposta.parsed_output,
      tokensEntrada: resposta.usage.input_tokens,
      tokensSaida: resposta.usage.output_tokens,
    };
  } catch (e) {
    if (e instanceof IAError) throw e;
    if (e instanceof Anthropic.AuthenticationError) {
      throw new IAError('Chave da Anthropic inválida ou expirada.', 401);
    }
    if (e instanceof Anthropic.RateLimitError) {
      throw new IAError('Limite de requisições atingido. Tente de novo em alguns segundos.', 429);
    }
    if (e instanceof Anthropic.APIError) {
      throw new IAError(`Erro na API da Anthropic: ${e.message}`, e.status);
    }
    throw new IAError(e instanceof Error ? e.message : 'Falha desconhecida ao ler o documento.');
  }
}
