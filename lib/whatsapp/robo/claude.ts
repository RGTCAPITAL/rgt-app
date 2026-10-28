import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { getCliente, IAError } from '@/lib/ia/client';
import { INSTRUCOES_ROBO } from './instrucoes';
import { decisaoRoboSchema, type DecisaoRobo } from './schema';
import type { EntradaRobo, MensagemHistorico } from './decidir';

/**
 * A chamada real ao Claude. Só servidor: usa a mesma chave da leitura de ofício.
 *
 * Opus 5.5 porque o interlocutor é um idoso falando de dinheiro e o tom é o
 * produto. Dá pra trocar por um modelo menor depois, medindo no simulador —
 * não antes.
 */
export const MODELO_ROBO = 'claude-opus-5-5';

/**
 * US$ por milhão de tokens (tabela de 2026-10-06; conferir em
 * platform.claude.com/pricing). Serve pro simulador mostrar o custo real de
 * cada resposta, não pra cobrar nada.
 */
const PRECO = { entrada: 4, saida: 20, cacheEscrita: 5, cacheLeitura: 0.2 };

export interface UsoIA {
  entrada: number;
  saida: number;
  cacheEscrita: number;
  cacheLeitura: number;
  custoUsd: number;
}

/** O que a RGT já sabe, numa mensagem de contexto antes da conversa. */
function contexto(entrada: EntradaRobo): string {
  const p = entrada.processo;
  const linhas = [
    '[Contexto da RGT — não é mensagem da pessoa. Use pra apresentar e pedir confirmação; nunca peça esses dados.]',
    `Credor: ${p?.credor ?? 'não sabemos'}`,
    `Tribunal: ${p?.tribunal ?? 'não sabemos'}`,
    `Devedor (contra quem é o processo): ${p?.ente_devedor ?? 'não sabemos'}`,
  ];
  return linhas.join('\n');
}

/**
 * Converte o histórico do WhatsApp pro formato da API: pessoa = user, RGT =
 * assistant. A API exige papéis alternados, então mensagens seguidas do mesmo
 * lado viram uma só — no WhatsApp é comum mandar três mensagens curtas
 * seguidas.
 *
 * O contexto entra como a primeira mensagem de user. Isso também resolve o
 * contato frio, em que a primeira mensagem da conversa é da RGT: a API não
 * aceita começar com assistant.
 */
export function montarMensagens(entrada: EntradaRobo): BetaMessageParam[] {
  const msgs: BetaMessageParam[] = [{ role: 'user', content: contexto(entrada) }];

  const texto = (m: MensagemHistorico) =>
    m.autor === 'humano' ? `[Mensagem enviada pela equipe RGT]\n${m.conteudo}` : m.conteudo;

  for (const m of entrada.historico) {
    const role = m.autor === 'contato' ? 'user' : 'assistant';
    const anterior = msgs.at(-1)!;
    if (anterior.role === role) {
      anterior.content = `${anterior.content as string}\n\n${texto(m)}`;
    } else {
      msgs.push({ role, content: texto(m) });
    }
  }
  return msgs;
}

export async function chamarClaude(
  entrada: EntradaRobo,
): Promise<{ decisao: DecisaoRobo; uso: UsoIA }> {
  const resp = await getCliente().beta.messages.parse({
    model: MODELO_ROBO,
    max_tokens: 8000,
    // Se o Opus recusar por classificador de segurança, a própria API refaz no
    // modelo de reserva dentro da mesma chamada, em vez de a conversa parar.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(decisaoRoboSchema) },
    system: [{ type: 'text', text: INSTRUCOES_ROBO, cache_control: { type: 'ephemeral' } }],
    messages: montarMensagens(entrada),
  });

  if (resp.stop_reason === 'refusal') throw new IAError('a IA recusou responder');
  if (!resp.parsed_output) {
    throw new IAError(
      resp.stop_reason === 'max_tokens' ? 'resposta da IA truncada' : 'formato inesperado da IA',
    );
  }

  const u = resp.usage;
  const uso: UsoIA = {
    entrada: u.input_tokens,
    saida: u.output_tokens,
    cacheEscrita: u.cache_creation_input_tokens ?? 0,
    cacheLeitura: u.cache_read_input_tokens ?? 0,
    custoUsd: 0,
  };
  uso.custoUsd =
    (uso.entrada * PRECO.entrada +
      uso.saida * PRECO.saida +
      uso.cacheEscrita * PRECO.cacheEscrita +
      uso.cacheLeitura * PRECO.cacheLeitura) /
    1_000_000;

  return { decisao: resp.parsed_output, uso };
}
