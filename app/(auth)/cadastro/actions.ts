'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function signUp(formData: FormData) {
  const nome = String(formData.get('nome') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!nome || !email || !password) {
    redirect(`/cadastro?error=${encodeURIComponent('Preencha todos os campos')}`);
  }
  if (password.length < 8) {
    redirect(`/cadastro?error=${encodeURIComponent('Senha precisa ter no mínimo 8 caracteres')}`);
  }

  const headersList = await headers();
  const origin = headersList.get('origin') ?? 'https://rgt-app-ten.vercel.app';

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { nome },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    redirect(`/cadastro?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/verifique-email?email=${encodeURIComponent(email)}`);
}
