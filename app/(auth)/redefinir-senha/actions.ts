'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { traduzirErroAuth } from '@/lib/auth-errors';

export async function updatePassword(formData: FormData) {
  const password = String(formData.get('password') ?? '');

  if (password.length < 8) {
    redirect(
      `/redefinir-senha?error=${encodeURIComponent('Senha precisa ter no mínimo 8 caracteres')}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect(`/redefinir-senha?error=${encodeURIComponent(traduzirErroAuth(error.message))}`);
  }

  redirect(
    `/login?message=${encodeURIComponent('Senha atualizada. Entre com a nova senha.')}`,
  );
}
