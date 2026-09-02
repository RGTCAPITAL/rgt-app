/**
 * Traduz mensagens de erro do Supabase Auth pra português coloquial.
 * Fallback: retorna a original se não reconhecer.
 */
export function traduzirErroAuth(msg: string): string {
  const m = msg.toLowerCase();

  // Rate limit — mensagem: "For security purposes, you can only request this after N seconds."
  const rate = msg.match(/after (\d+) seconds?/i);
  if (rate) {
    const s = Number(rate[1]);
    return `Muitas tentativas — aguarde ${s} segundo${s === 1 ? '' : 's'} antes de tentar novamente.`;
  }
  if (m.includes('email rate limit') || m.includes('over_email_send_rate_limit')) {
    return 'Limite de emails do servidor atingido (plano do Supabase). Fale com o admin — precisa configurar SMTP próprio ou aguarde ~1 hora.';
  }

  // Signup
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'Este email já está cadastrado. Tente entrar ou recuperar a senha.';
  }
  if (m.includes('signup') && m.includes('disabled')) {
    return 'Cadastros estão desativados temporariamente. Fale com o admin.';
  }

  // Senha
  if (m.includes('password should be at least')) {
    return 'Senha muito curta (mínimo 8 caracteres).';
  }
  if (m.includes('weak password') || m.includes('password is too weak')) {
    return 'Senha muito fraca. Use letras, números e símbolos.';
  }
  if (m.includes('same as the old password') || m.includes('should be different')) {
    return 'A nova senha precisa ser diferente da anterior.';
  }

  // Login
  if (m.includes('invalid login credentials') || m.includes('invalid email or password')) {
    return 'Email ou senha inválidos.';
  }
  if (m.includes('email not confirmed')) {
    return 'Você precisa confirmar seu email antes de entrar. Cheque sua caixa de entrada.';
  }

  // Email
  if (m.includes('invalid email') || m.includes('email format')) {
    return 'Email inválido.';
  }
  if (m.includes('email not found')) {
    return 'Email não encontrado.';
  }

  // Sessão
  if (m.includes('jwt expired') || m.includes('session expired')) {
    return 'Sua sessão expirou. Entre novamente.';
  }

  // Fallback
  return msg;
}
