'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { STATUS_LEAD, type StatusLead } from '@/lib/leads';

type Result = { ok: true } | { ok: false; error: string };

const STATUS_VALIDOS = STATUS_LEAD.map((s) => s.value) as readonly StatusLead[];

export async function mudarStatusLead(
  leadId: string,
  novoStatus: StatusLead,
  motivoPerda?: string,
): Promise<Result> {
  if (!STATUS_VALIDOS.includes(novoStatus)) {
    return { ok: false, error: 'Status inválido.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  // Se está indo pra 'ganho', bloqueia — ganho só via "Virar operação" (RGT-63)
  if (novoStatus === 'ganho') {
    return {
      ok: false,
      error: 'Pra marcar como "Ganho", use o botão "Virar operação" no card.',
    };
  }

  // Se está indo pra 'perdido', exige motivo (constraint do banco também exige)
  if (novoStatus === 'perdido' && !motivoPerda?.trim()) {
    return { ok: false, error: 'Informe o motivo da perda.' };
  }

  const update: Record<string, unknown> = { status: novoStatus };
  if (novoStatus === 'perdido') update.motivo_perda = motivoPerda!.trim();
  if (novoStatus !== 'perdido') update.motivo_perda = null; // limpa se saiu de perdido

  const { data: updated, error } = await supabase
    .from('leads')
    .update(update)
    .eq('id', leadId)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: 'Lead não encontrado ou sem permissão.' };

  revalidatePath('/crm');
  return { ok: true };
}
