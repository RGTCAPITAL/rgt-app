'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { exigirPerfil } from '@/lib/auth/roles';
import type { BaseDesagio } from '@/lib/precificacao/desagio';

/**
 * Cadastro do percentual de aquisição por ano de LOA.
 *
 * É o parâmetro que define quanto a empresa paga por um precatório. O gate é
 * admin/gestão antes de qualquer coisa, e a RLS da migration 041 repete a
 * checagem no banco — defesa em profundidade, porque uma policy pode ser
 * afrouxada por acidente num refactor (a migration 016 já provou isso aqui).
 */

type Result = { ok: true } | { ok: false; error: string };

const BASES: readonly BaseDesagio[] = ['face', 'liquido'];

export async function salvarFator(payload: {
  loaAno: number;
  percentual: number;
  base: string;
  vigenteDesde: string;
  observacao: string;
}): Promise<Result> {
  const auth = await exigirPerfil(['admin', 'gestao']);
  if (!auth.ok) return { ok: false, error: auth.error };

  const { loaAno, percentual, vigenteDesde } = payload;

  if (!Number.isInteger(loaAno) || loaAno < 2020 || loaAno > 2100) {
    return { ok: false, error: 'Ano da LOA fora da faixa (2020 a 2100).' };
  }
  if (!Number.isFinite(percentual) || percentual <= 0 || percentual > 100) {
    return { ok: false, error: 'O percentual tem que estar entre 0 e 100.' };
  }
  if (!BASES.includes(payload.base as BaseDesagio)) {
    // Sem default: face e líquido dão preços muito diferentes, e assumir um
    // produziria proposta errada numa operação real.
    return { ok: false, error: 'Escolha se o percentual incide sobre a face ou sobre o líquido.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenteDesde)) {
    return { ok: false, error: 'Data de início inválida.' };
  }

  const supabase = await createClient();

  // Upsert por (loa_ano, vigente_desde): corrigir o valor que acabou de ser
  // digitado é a mesma vigência, não uma nova. Criar vigência ANTERIOR a uma
  // existente é bloqueado pelo trigger do banco, não aqui — a regra mora onde
  // não dá pra contornar.
  const { error } = await supabase.from('fatores_loa').upsert(
    {
      loa_ano: loaAno,
      percentual,
      base: payload.base,
      vigente_desde: vigenteDesde,
      observacao: payload.observacao.trim() || null,
      criado_por: auth.userId,
    },
    { onConflict: 'loa_ano,vigente_desde' },
  );

  if (error) {
    // A mensagem do trigger é escrita pra ser lida por pessoa; repassar é
    // melhor que trocar por um genérico.
    return { ok: false, error: error.message };
  }

  revalidatePath('/admin/desagio');
  revalidatePath('/operacoes', 'layout');
  return { ok: true };
}
