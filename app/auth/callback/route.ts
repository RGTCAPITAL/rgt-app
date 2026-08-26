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
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/';

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
  }

  // Fluxo 2: PKCE (code)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(
      'Não foi possível confirmar. Link inválido ou expirado.',
    )}`,
  );
}
