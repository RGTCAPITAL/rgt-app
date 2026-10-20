'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { traduzirErroAuth } from '@/lib/auth-errors';

export async function resetPassword(formData: FormData) {
  // Normaliza igual ao convite de admin. O zero-width space (U+200B) vem colado
  // junto quando o email é copiado de outro lugar e o trim() NÃO o remove — o
  // GoTrue então não casa com nenhum usuário e responde 200, indistinguível de
  // sucesso. Minúsculas porque o GoTrue compara o email já normalizado.
  const email = String(formData.get('email') ?? '')
    .replace(/[​-‍﻿]/g, '')
    .trim()
    .toLowerCase();

  if (!email) {
    redirect(`/esqueci-senha?error=${encodeURIComponent('Preencha o email')}`);
  }

  const headersList = await headers();
  const origin = headersList.get('origin') ?? 'https://rgt-app-ten.vercel.app';

  const supabase = await createClient();

  // O link PRECISA passar por /auth/callback — é o único lugar do repo que troca
  // o token/code por sessão (verifyOtp / exchangeCodeForSession). Apontando direto
  // pra /redefinir-senha, a página abre sem sessão e o updateUser estoura com
  // "Auth session missing". Mesmo padrão do convite em admin/usuarios/actions.ts.
  //
  // A query string `?next=` tem que continuar aqui: o template de Reset Password
  // no dashboard do Supabase monta o link como
  //   {{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery
  // e concatena com `&`. Sem o `?next=`, o primeiro parâmetro vira `&` solto e o
  // link quebra. Se um dia tirar o `next`, troque o template pra começar com `?`.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/redefinir-senha`,
  });

  // O erro vai pro log do servidor SEMPRE. Sem isto, SMTP fora do ar (500) e
  // rate limit (429) viram a mesma mensagem verde de sucesso — foi exatamente
  // o que escondeu este bug e custou uma sessão inteira de investigação.
  if (error) {
    console.error('[reset-senha]', email, error.status, error.message);
  }

  // Na tela só aparece erro que NÃO revela se a conta existe (falha de envio,
  // rate limit). O resto cai na mensagem neutra: enumeração de conta segue
  // bloqueada.
  if (error && (error.status === 429 || /rate|sending|smtp/i.test(error.message))) {
    redirect(`/esqueci-senha?error=${encodeURIComponent(traduzirErroAuth(error.message))}`);
  }

  // Sempre retornamos sucesso mesmo se o email não existe (evita enumeração de contas)
  redirect(
    `/esqueci-senha?message=${encodeURIComponent(
      'Se o email existe na base, um link de reset foi enviado.',
    )}`,
  );
}
