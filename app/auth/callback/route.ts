import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Callback route pra Supabase Auth.
 * Trata os 2 formatos que o Supabase pode enviar:
 *
 * 1. Email OTP (padrão pra confirmação de cadastro / reset de senha):
 *    /auth/callback?token_hash=xxx&type=signup&next=/
 *
 * 2. PKCE (usado por OAuth e algumas rotas modernas):
 *    /auth/callback?code=xxx&next=/
 */
/**
 * Só aceita caminho relativo same-origin. Sem isso, `next=@evil.com/x` faz
 * `${origin}${next}` virar `https://app.com@evil.com/x` — o browser lê
 * `app.com` como userinfo e navega pra evil.com com a sessão já criada.
 */
function destinoSeguro(next: string | null): string {
  if (!next) return '/';
  if (!next.startsWith('/')) return '/';
  if (next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = destinoSeguro(searchParams.get('next'));

  const supabase = await createClient();

  // Fluxo 1: Email OTP (confirmação, reset, magic link)
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      // Reset de senha: redireciona pra /redefinir-senha
      // Signup/magic link: redireciona pro dashboard ou `next`
      const target = type === 'recovery' ? '/redefinir-senha' : next;
      return NextResponse.redirect(`${origin}${target}`);
    }
    console.error('[auth/callback] verifyOtp', { type }, error.message);
  }

  // Fluxo 2: PKCE (code).
  // É por aqui que o reset de senha cai: o @supabase/ssr usa flowType pkce por
  // padrão (as linhas de auth.flow_state têm code_challenge_method='s256').
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Mesma resolução do branch OTP, e ela é obrigatória: sem isto, um reset
      // que chegue sem `next` manda a pessoa LOGADA pro dashboard com a senha
      // antiga e sem aviso nenhum — o pior modo de falha possível aqui.
      const target = type === 'recovery' ? '/redefinir-senha' : next;
      return NextResponse.redirect(`${origin}${target}`);
    }
    // Token expirado, verifier ausente (link aberto noutro browser) e type
    // errado colapsavam todos em "Link inválido ou expirado" sem rastro.
    console.error('[auth/callback] exchangeCodeForSession', error.message);
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(
      'Não foi possível confirmar. Link inválido ou expirado.',
    )}`,
  );
}
