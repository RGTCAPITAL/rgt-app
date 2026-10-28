import { z } from 'zod';

/**
 * O que o roteiro manda coletar. Tudo nulo até a pessoa dizer — o robô nunca
 * preenche por dedução, porque o broker vai agir em cima disso.
 *
 * O que NÃO está aqui é decisão de projeto: CPF, RG, dado bancário, valor,
 * ente devedor e idade. Os três últimos a RGT já tem; os primeiros, pedir por
 * WhatsApp é o comportamento do golpista.
 */
export const dadosColetadosSchema = z.object({
  titularidade_confirmada: z
    .boolean()
    .nullable()
    .describe('A pessoa confirmou que o processo apresentado é dela.'),
  interesse_em_vender: z
    .enum(['sim', 'nao', 'talvez'])
    .nullable()
    .describe(
      'Interesse em vender agora. "talvez" inclui "vou pensar" e "vou falar com a família".',
    ),
  estado_civil: z.enum(['solteiro', 'casado', 'uniao_estavel', 'divorciado', 'viuvo']).nullable(),
  cessao_anterior: z
    .boolean()
    .nullable()
    .describe('Já assinou algum papel ou fez negócio com outra empresa sobre esse crédito.'),
  tem_advogado_no_processo: z.boolean().nullable(),
  acompanhante_familiar: z
    .boolean()
    .nullable()
    .describe('Quer um familiar acompanhando a negociação.'),
  motivo_da_venda: z
    .string()
    .nullable()
    .describe('Só se a pessoa contou espontaneamente. Nunca perguntar.'),
  // Os três abaixo só existem quando a RGT não sabia nada da pessoa (escreveu
  // direto, sem formulário). Com processo conhecido, ficam null: o dado da
  // RGT é mais confiável que a lembrança do credor.
  devedor_informado: z
    .string()
    .nullable()
    .describe('Contra quem é o processo, como a pessoa disse. Só se a RGT não sabia.'),
  tribunal_informado: z
    .string()
    .nullable()
    .describe('Tribunal ou cidade do processo, como a pessoa disse. Só se a RGT não sabia.'),
  numero_processo_informado: z
    .string()
    .nullable()
    .describe('Número do processo como a pessoa escreveu, sem corrigir. Só se a RGT não sabia.'),
});

export type DadosColetados = z.infer<typeof dadosColetadosSchema>;

export const decisaoRoboSchema = z.object({
  resposta: z.string().describe('A próxima mensagem do robô no WhatsApp.'),
  entendeu: z.boolean().describe('false quando não deu pra entender o que a pessoa quis dizer.'),
  passar_para_humano: z.boolean(),
  motivo_passagem: z
    .string()
    .nullable()
    .describe('Uma frase pro broker: por que a conversa está vindo pra ele.'),
  dados: dadosColetadosSchema.describe(
    'Estado completo do que já foi confirmado na conversa inteira, não só nesta mensagem.',
  ),
});

export type DecisaoRobo = z.infer<typeof decisaoRoboSchema>;

/** Os que o roteiro marca como obrigatórios. Completos, o robô sai de cena. */
export const CAMPOS_OBRIGATORIOS = [
  'titularidade_confirmada',
  'interesse_em_vender',
  'estado_civil',
  'cessao_anterior',
  'tem_advogado_no_processo',
] as const satisfies readonly (keyof DadosColetados)[];

export function coletaCompleta(d: DadosColetados): boolean {
  return CAMPOS_OBRIGATORIOS.every((campo) => d[campo] !== null);
}

/** Rótulos pra tela: simulador e conversa do broker mostram igual. */
export const ROTULO_DADO: Record<keyof DadosColetados, string> = {
  titularidade_confirmada: 'Processo é dela',
  interesse_em_vender: 'Interesse em vender',
  estado_civil: 'Estado civil',
  cessao_anterior: 'Já assinou com outra empresa',
  tem_advogado_no_processo: 'Tem contato com o advogado',
  acompanhante_familiar: 'Quer familiar junto',
  motivo_da_venda: 'Motivo (espontâneo)',
  devedor_informado: 'Contra quem (disse)',
  tribunal_informado: 'Tribunal (disse)',
  numero_processo_informado: 'Nº do processo (disse)',
};

export function valorDado(v: DadosColetados[keyof DadosColetados] | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v === true) return 'sim';
  if (v === false) return 'não';
  return String(v).replace('_', ' ');
}
