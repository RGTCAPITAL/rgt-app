'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { STATUS_LEAD, type StatusLead } from '@/lib/leads';
import { leadFormSchema } from './lead-schemas';

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const STATUS_VALIDOS = STATUS_LEAD.map((s) => s.value) as readonly StatusLead[];

export async function criarLead(payload: Record<string, unknown>): Promise<Result<{ id: string }>> {
  const parsed = leadFormSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  // Broker só cria pra si mesmo — força dono_id = self
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();
  const isBroker = usuario?.perfil?.slug === 'broker';

  const insert = {
    nome: parsed.data.nome,
    telefone: parsed.data.telefone || null,
    email: parsed.data.email || null,
    cpf_cnpj: parsed.data.cpf_cnpj || null,
    origem: parsed.data.origem,
    notas: parsed.data.notas || null,
    dono_id: isBroker ? user.id : (parsed.data.dono_id || null),
    status: 'novo' as const,
  };

  const { data, error } = await supabase.from('leads').insert(insert).select('id').single();
  if (error) return { ok: false, error: error.message };

  revalidatePath('/crm');
  return { ok: true, data: { id: data.id } };
}

export async function atualizarLead(
  leadId: string,
  payload: Record<string, unknown>,
): Promise<Result> {
  const parsed = leadFormSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const update = {
    nome: parsed.data.nome,
    telefone: parsed.data.telefone || null,
    email: parsed.data.email || null,
    cpf_cnpj: parsed.data.cpf_cnpj || null,
    origem: parsed.data.origem,
    notas: parsed.data.notas || null,
    dono_id: parsed.data.dono_id || null,
  };

  const { data, error } = await supabase
    .from('leads')
    .update(update)
    .eq('id', leadId)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Lead não encontrado ou sem permissão.' };

  revalidatePath('/crm');
  return { ok: true };
}

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
