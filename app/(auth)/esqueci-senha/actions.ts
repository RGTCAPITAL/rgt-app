'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function resetPassword(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();

  if (!email) {
    redirect(`/esqueci-senha?error=${encodeURIComponent('Preencha o email')}`);
  }

  const headersList = await headers();
  const origin = headersList.get('origin') ?? 'https://rgt-app-ten.vercel.app';

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/redefinir-senha`,
  });

  // Sempre retornamos sucesso mesmo se o email não existe (evita enumeração de contas)
  redirect(
    `/esqueci-senha?message=${encodeURIComponent(
      'Se o email existe na base, um link de reset foi enviado.',
    )}`,
  );
}
