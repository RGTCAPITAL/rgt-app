'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };

const PERFIS = ['admin', 'gestao', 'juridico', 'broker'] as const;
const STATUS = ['pendente', 'em_andamento', 'concluida', 'cancelada'] as const;

export async function criarTarefa(payload: {
  operacaoId: string;
  titulo: string;
  descricao?: string;
  destinatarioPerfil?: string;
  destinatarioId?: string;
  prazo?: string;
}): Promise<Result> {
  const titulo = payload.titulo.trim();
  if (!titulo) return { ok: false, error: 'Título obrigatório.' };
  if (!payload.destinatarioPerfil && !payload.destinatarioId) {
    return { ok: false, error: 'Escolha um destinatário (perfil ou pessoa).' };
  }
  if (payload.destinatarioPerfil && !PERFIS.includes(payload.destinatarioPerfil as (typeof PERFIS)[number])) {
    return { ok: false, error: 'Perfil inválido.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { error } = await supabase.from('tarefas').insert({
    operacao_id: payload.operacaoId,
    titulo,
    descricao: payload.descricao?.trim() || null,
    criado_por_id: user.id,
    destinatario_perfil: payload.destinatarioPerfil || null,
    destinatario_id: payload.destinatarioId || null,
    prazo: payload.prazo || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/operacoes/${payload.operacaoId}`);
  revalidatePath('/tarefas');
  return { ok: true };
}

export async function atualizarStatusTarefa(
  tarefaId: string,
  novoStatus: string,
): Promise<Result> {
  if (!STATUS.includes(novoStatus as (typeof STATUS)[number])) {
    return { ok: false, error: 'Status inválido.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const update: Record<string, unknown> = { status: novoStatus };
  if (novoStatus === 'concluida') {
    update.concluida_em = new Date().toISOString();
    update.concluida_por_id = user.id;
  } else {
    update.concluida_em = null;
    update.concluida_por_id = null;
  }

  const { data, error } = await supabase
    .from('tarefas')
    .update(update)
    .eq('id', tarefaId)
    .select('id, operacao_id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Tarefa não encontrada ou sem permissão.' };

  revalidatePath(`/operacoes/${data.operacao_id}`);
  revalidatePath('/tarefas');
  return { ok: true };
}
