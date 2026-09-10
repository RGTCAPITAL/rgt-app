import { z } from 'zod';

/**
 * Formato de saída da extração do ofício requisitório.
 *
 * É uma **lista** de campos encontrados, não um objeto com 18 chaves fixas.
 * Duas razões:
 *
 * 1. A API compila o schema numa gramática pra forçar o formato da resposta, e
 *    objeto com 20 propriedades no topo estoura o limite ("The compiled grammar
 *    is too large"). Array de um objeto pequeno tem gramática constante.
 * 2. Campo ausente e campo nulo viram a mesma coisa — o modelo só emite o que
 *    achou, em vez de 18 `null` que ninguém lê.
 *
 * Nome de campo desconhecido é ignorado pelo resolver, então o modelo inventar
 * uma chave nova não quebra nada.
 */

const confianca = z.enum(['alta', 'media', 'baixa']);
export type Confianca = z.infer<typeof confianca>;

/** Os nomes que o resolver sabe traduzir. A lista vai no prompt também. */
export const CAMPOS_CONHECIDOS = [
  'cedente_nome',
  'cedente_cpf',
  'numero_processo',
  'tipo',
  'natureza',
  'especie',
  'ente_devedor',
  'tribunal_sigla',
  'data_base',
  'data_autuacao',
  'loa',
  'valor_principal',
  'valor_juros',
  'valor_selic',
  'retencao_honorarios_pct',
  'pss_pct',
  'rra_meses',
] as const;

export type NomeCampo = (typeof CAMPOS_CONHECIDOS)[number];

export const extracaoOficioSchema = z.object({
  documento_reconhecido: z
    .boolean()
    .describe(
      'true se o arquivo é ofício requisitório, precatório, RPV ou documento equivalente de requisição de pagamento',
    ),
  observacao: z
    .string()
    .nullable()
    .describe(
      'Uma frase sobre o documento quando algo relevante fugir do padrão (ilegível, mais de um beneficiário, valores rasurados). Null se estiver normal.',
    ),
  campos: z
    .array(
      z.object({
        campo: z.string().describe('Nome do campo, exatamente como listado na tabela'),
        valor: z.string().describe('O valor extraído, no formato pedido para aquele campo'),
        confianca,
        trecho: z.string().describe('Citação literal do documento onde o valor aparece'),
      }),
    )
    .describe('Só os campos que você realmente encontrou. Omita o resto.'),
});

export type ExtracaoOficio = z.infer<typeof extracaoOficioSchema>;
export type CampoExtraido = { valor: string | null; confianca: Confianca; trecho: string | null };

/** Indexa a lista por nome de campo, descartando repetido e nome desconhecido. */
export function indexarCampos(extracao: ExtracaoOficio): Map<string, CampoExtraido> {
  const mapa = new Map<string, CampoExtraido>();
  const conhecidos = new Set<string>(CAMPOS_CONHECIDOS);
  for (const c of extracao.campos) {
    const nome = c.campo.trim();
    if (!conhecidos.has(nome) || mapa.has(nome)) continue;
    mapa.set(nome, { valor: c.valor, confianca: c.confianca, trecho: c.trecho });
  }
  return mapa;
}

export const CAMPO_AUSENTE: CampoExtraido = { valor: null, confianca: 'baixa', trecho: null };
