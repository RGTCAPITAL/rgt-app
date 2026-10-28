'use server';

import { z } from 'zod';
import { exigirPerfil } from '@/lib/auth/roles';
import { iaConfigurada } from '@/lib/ia/client';
import { decidirProximoPasso, type PlanoRobo } from '@/lib/whatsapp/robo/decidir';
import { chamarClaude, type UsoIA } from '@/lib/whatsapp/robo/claude';
import { LIMITE_TEXTO_WHATSAPP } from '@/lib/whatsapp/conversas';

const entradaSchema = z.object({
  historico: z
    .array(
      z.object({
        autor: z.enum(['contato', 'bot', 'humano']),
        conteudo: z.string().max(LIMITE_TEXTO_WHATSAPP),
      }),
    )
    .min(1)
    .max(60),
  ctx: z.object({
    recusasDePreco: z.number().int().min(0),
    naoEntendidasSeguidas: z.number().int().min(0),
    idadeTitular: z.number().int().min(0).max(130).nullable(),
  }),
  processo: z.object({
    credor: z.string().max(200).nullable(),
    tribunal: z.string().max(40).nullable(),
    ente_devedor: z.string().max(200).nullable(),
    numero_processo: z.string().max(40).nullable(),
  }),
});

export type EntradaSimulador = z.infer<typeof entradaSchema>;

/**
 * Uma rodada do robô de verdade — freios + Claude — sem banco e sem WhatsApp.
 * Cada chamada gasta API, por isso só admin e gestão.
 */
export async function simularRobo(
  input: EntradaSimulador,
): Promise<{ ok: true; plano: PlanoRobo; uso: UsoIA | null } | { ok: false; error: string }> {
  const auth = await exigirPerfil(['admin', 'gestao']);
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!iaConfigurada()) return { ok: false, error: 'ANTHROPIC_API_KEY não configurada.' };

  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Conversa inválida.' };
  if (parsed.data.historico.at(-1)?.autor !== 'contato') {
    return { ok: false, error: 'A última mensagem tem que ser da pessoa.' };
  }

  let uso: UsoIA | null = null;
  const plano = await decidirProximoPasso(parsed.data, async (entrada) => {
    const r = await chamarClaude(entrada);
    uso = r.uso;
    return r.decisao;
  });

  return { ok: true, plano, uso };
}
