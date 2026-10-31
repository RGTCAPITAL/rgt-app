'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigirPerfil } from '@/lib/auth/roles';
import { LIMITES } from '@/lib/regras/decidir';
import { createClient } from '@/lib/supabase/server';

/**
 * Ligar, desligar e ajustar as regras automáticas.
 *
 * Ligar uma regra muda o trabalho da equipe inteira — amanhã cedo cada broker
 * pode acordar com tarefas novas —, então é de admin e gestão, como os
 * modelos de mensagem. A RLS da 048 diz o mesmo; a checagem aqui só dá a
 * mensagem certa antes de chegar no banco.
 */

const inteiro = (f: { min: number; max: number }) => z.number().int().min(f.min).max(f.max);

const entradaSchema = z.discriminatedUnion('chave', [
  z.object({
    chave: z.literal('follow_up'),
    ativa: z.boolean(),
    dias: inteiro(LIMITES.followUpDias),
    maxTentativas: inteiro(LIMITES.followUpMaxTentativas),
  }),
  z.object({
    chave: z.literal('lead_parado'),
    ativa: z.boolean(),
    dias: inteiro(LIMITES.leadParadoDias),
  }),
  z.object({ chave: z.literal('processo_andou'), ativa: z.boolean() }),
]);

export type EntradaRegra = z.infer<typeof entradaSchema>;

export async function salvarRegra(
  entrada: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await exigirPerfil(['admin', 'gestao']);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = entradaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: 'Confira os números: algum está fora da faixa permitida.' };
  }
  const e = parsed.data;

  // Mesmo formato que o CHECK regras_automaticas_parametros_validos espera.
  const parametros =
    e.chave === 'follow_up'
      ? { dias: e.dias, max_tentativas: e.maxTentativas }
      : e.chave === 'lead_parado'
        ? { dias: e.dias }
        : {};

  // Cliente da sessão, não service role: a RLS da 048 vale aqui também.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('regras_automaticas')
    .update({ ativa: e.ativa, parametros, atualizado_por: auth.userId })
    .eq('chave', e.chave)
    .select('chave')
    .maybeSingle();

  if (error) return { ok: false, error: 'Não foi possível salvar a regra.' };
  // Update barrado pela RLS não dá erro: só não devolve linha.
  if (!data) return { ok: false, error: 'Sem permissão.' };

  revalidatePath('/admin/regras');
  return { ok: true };
}
