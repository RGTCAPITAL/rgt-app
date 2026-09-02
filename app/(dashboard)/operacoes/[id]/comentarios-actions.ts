'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };

export async function criarComentario(operacaoId: string, texto: string): Promise<Result> {
  const conteudo = texto.trim();
  if (!conteudo) return { ok: false, error: 'Comentário vazio.' };
  if (conteudo.length > 5000)
    return { ok: false, error: 'Comentário muito longo (máx 5000 caracteres).' };

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: op } = await supabase
    .from('operacoes')
    .select('etapa_atual')
    .eq('id', operacaoId)
    .single<{ etapa_atual: string }>();

  if (!op) return { ok: false, error: 'Operação não encontrada.' };

  const { error } = await supabase.from('comentarios').insert({
    operacao_id: operacaoId,
    etapa: op.etapa_atual,
    autor_id: user.id,
    texto: conteudo,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/operacoes/${operacaoId}`);
  return { ok: true };
}

export async function deletarComentario(operacaoId: string, comentarioId: string): Promise<Result> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  // RLS já garante que só autor ou admin conseguem deletar
  const { error } = await supabase.from('comentarios').delete().eq('id', comentarioId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/operacoes/${operacaoId}`);
  return { ok: true };
}
