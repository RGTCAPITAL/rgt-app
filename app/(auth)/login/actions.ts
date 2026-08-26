'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent('Preencha email e senha')}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Não vazamos qual dos dois (email/senha) está errado — melhor pra segurança
    redirect(`/login?error=${encodeURIComponent('Email ou senha inválidos')}`);
  }

  revalidatePath('/', 'layout');
  redirect('/');
}
