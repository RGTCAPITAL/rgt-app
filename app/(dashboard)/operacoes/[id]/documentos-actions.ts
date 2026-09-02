'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { TIPOS_DOCUMENTO, type TipoDocumento } from '@/lib/documentos-checklist';

const BUCKET = 'operacao-docs';
const MAX_BYTES = 20 * 1024 * 1024; // 20MB (mesmo do bucket)

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const isTipoValido = (v: string): v is TipoDocumento =>
  TIPOS_DOCUMENTO.some((t) => t.value === v);

export async function uploadDocumento(formData: FormData): Promise<Result<{ id: string }>> {
  const operacaoId = String(formData.get('operacao_id') ?? '');
  const tipo = String(formData.get('tipo') ?? '');
  const file = formData.get('file');

  if (!operacaoId || !isTipoValido(tipo)) {
    return { ok: false, error: 'Dados inválidos.' };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Selecione um arquivo.' };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `Arquivo maior que 20MB (${(file.size / 1024 / 1024).toFixed(1)}MB).` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin';
  const timestamp = Date.now();
  const storagePath = `${operacaoId}/${tipo}_${timestamp}.${ext}`;

  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (uploadErr) return { ok: false, error: `Falha ao subir arquivo: ${uploadErr.message}` };

  const { data: inserted, error: dbErr } = await supabase
    .from('documentos')
    .insert({
      operacao_id: operacaoId,
      tipo,
      nome_original: file.name,
      storage_path: storagePath,
      mime_type: file.type || null,
      tamanho_bytes: file.size,
      uploaded_by: user.id,
    })
    .select('id')
    .single();

  if (dbErr) {
    // rollback: apaga o arquivo do storage
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { ok: false, error: `Falha ao gravar metadata: ${dbErr.message}` };
  }

  revalidatePath(`/operacoes/${operacaoId}`);
  return { ok: true, data: { id: inserted.id } };
}

export async function deletarDocumento(
  operacaoId: string,
  documentoId: string,
): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: doc, error: fetchErr } = await supabase
    .from('documentos')
    .select('operacao_id, storage_path, uploaded_by')
    .eq('id', documentoId)
    .maybeSingle<{ operacao_id: string; storage_path: string; uploaded_by: string | null }>();

  if (fetchErr) return { ok: false, error: 'Erro ao localizar documento.' };
  if (!doc) return { ok: false, error: 'Documento não encontrado.' };

  // Cross-check: garante que o operacaoId passado bate com o dono real do doc.
  // Sem isso, cliente malicioso passa operacaoId errado e revalidatePath vai pra página errada.
  if (doc.operacao_id !== operacaoId) {
    return { ok: false, error: 'Documento não pertence a esta operação.' };
  }

  // Deleta com .select().maybeSingle() pra distinguir "não existe" de "RLS bloqueou":
  // - erro real → { error }
  // - RLS bloqueou → { data: null, error: null }  ← precisamos detectar
  // - sucesso → { data: { id } }
  const { data: deleted, error: delDbErr } = await supabase
    .from('documentos')
    .delete()
    .eq('id', documentoId)
    .select('id')
    .maybeSingle();

  if (delDbErr) return { ok: false, error: delDbErr.message };
  if (!deleted) return { ok: false, error: 'Sem permissão pra apagar este documento (só o uploader ou admin).' };

  const { error: delStorageErr } = await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  if (delStorageErr) {
    // Metadata já foi deletada — arquivo órfão no storage. Admin pode limpar depois.
    console.error('Metadata deletada mas arquivo ficou órfão:', delStorageErr.message);
  }

  revalidatePath(`/operacoes/${operacaoId}`);
  return { ok: true };
}

export async function getSignedUrl(
  storagePath: string,
): Promise<Result<{ url: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60);

  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao gerar URL.' };
  return { ok: true, data: { url: data.signedUrl } };
}
