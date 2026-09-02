'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { traduzirErroAuth } from '@/lib/auth-errors';

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const emailParam = encodeURIComponent(email);

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent('Preencha email e senha')}&email=${emailParam}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Rate-limit e "email not confirmed" vão traduzidos; resto cai no genérico por segurança
    const lower = error.message.toLowerCase();
    const usuario_amigavel =
      lower.includes('email not confirmed') ||
      lower.includes('rate') ||
      lower.includes('after')
        ? traduzirErroAuth(error.message)
        : 'Email ou senha inválidos';
    redirect(`/login?error=${encodeURIComponent(usuario_amigavel)}&email=${emailParam}`);
  }

  revalidatePath('/', 'layout');
  redirect('/');
}
