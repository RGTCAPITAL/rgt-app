'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

type Result = { ok: true } | { ok: false; error: string };

const PERFIS_VALIDOS = ['admin', 'gestao', 'juridico', 'broker'] as const;
type PerfilSlug = (typeof PERFIS_VALIDOS)[number];

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, isAdmin: false } as const;

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();

  return {
    supabase,
    user,
    isAdmin: usuario?.perfil?.slug === 'admin',
  } as const;
}

/**
 * Convida alguém pro workspace com um perfil já definido.
 *
 * Substitui o /cadastro público: usuário só nasce por convite de admin, e o
 * perfil vem escolhido daqui (a trigger handle_new_user lê dos metadados).
 * A senha nunca passa por aqui — o convidado define a dele pelo link do email.
 */
export async function convidarUsuario(
  email: string,
  nome: string,
  perfil: string,
): Promise<Result> {
  const emailLimpo = email.trim().toLowerCase();
  const nomeLimpo = nome.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo)) {
    return { ok: false, error: 'E-mail inválido.' };
  }
  if (nomeLimpo.length < 2) {
    return { ok: false, error: 'Nome obrigatório.' };
  }
  if (!PERFIS_VALIDOS.includes(perfil as PerfilSlug)) {
    return { ok: false, error: 'Perfil inválido.' };
  }

  const { user, isAdmin } = await requireAdmin();
  if (!user) return { ok: false, error: 'Sessão expirada.' };
  if (!isAdmin) return { ok: false, error: 'Só admin pode convidar usuários.' };

  const origin = (await headers()).get('origin') ?? 'https://rgt-app-ten.vercel.app';

  // service role: convidar exige privilégio de admin da Auth API
  const admin = createServiceClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(emailLimpo, {
    data: { nome: nomeLimpo, perfil },
    redirectTo: `${origin}/auth/callback?next=/redefinir-senha`,
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('already') || msg.includes('registered')) {
      return { ok: false, error: 'Esse e-mail já tem conta no sistema.' };
    }
    // O convite depende de SMTP configurado no projeto Supabase
    return { ok: false, error: `Falha ao enviar convite: ${error.message}` };
  }

  revalidatePath('/admin/usuarios');
  return { ok: true };
}

export async function atualizarPerfil(userId: string, novoPerfil: string): Promise<Result> {
  if (!PERFIS_VALIDOS.includes(novoPerfil as PerfilSlug)) {
    return { ok: false, error: 'Perfil inválido.' };
  }

  const { supabase, user, isAdmin } = await requireAdmin();
  if (!user) return { ok: false, error: 'Sessão expirada.' };
  if (!isAdmin) return { ok: false, error: 'Só admin pode mudar perfil.' };

  // Se está rebaixando admin, garante que sobra pelo menos um admin ativo
  if (novoPerfil !== 'admin') {
    const { data: alvo } = await supabase
      .from('usuarios')
      .select('perfil:perfis(slug), ativo')
      .eq('id', userId)
      .single<{ perfil: { slug: string } | null; ativo: boolean }>();

    if (alvo?.perfil?.slug === 'admin' && alvo.ativo) {
      const { count } = await supabase
        .from('usuarios')
        .select('id, perfil:perfis!inner(slug)', { count: 'exact', head: true })
        .eq('ativo', true)
        .eq('perfis.slug', 'admin');
      if ((count ?? 0) <= 1) {
        return { ok: false, error: 'Não é possível rebaixar o único admin ativo.' };
      }
    }
  }

  const { data: perfil } = await supabase
    .from('perfis')
    .select('id')
    .eq('slug', novoPerfil)
    .single<{ id: string }>();
  if (!perfil) return { ok: false, error: 'Perfil não encontrado.' };

  const { data: updated, error } = await supabase
    .from('usuarios')
    .update({ perfil_id: perfil.id })
    .eq('id', userId)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: 'Usuário não encontrado ou RLS bloqueou.' };

  revalidatePath('/admin/usuarios');
  return { ok: true };
}

export async function toggleAtivo(userId: string, novoAtivo: boolean): Promise<Result> {
  const { supabase, user, isAdmin } = await requireAdmin();
  if (!user) return { ok: false, error: 'Sessão expirada.' };
  if (!isAdmin) return { ok: false, error: 'Só admin pode ativar/desativar.' };

  // Se está desativando admin, garante que sobra pelo menos um admin ativo
  if (!novoAtivo) {
    const { data: alvo } = await supabase
      .from('usuarios')
      .select('perfil:perfis(slug)')
      .eq('id', userId)
      .single<{ perfil: { slug: string } | null }>();

    if (alvo?.perfil?.slug === 'admin') {
      const { count } = await supabase
        .from('usuarios')
        .select('id, perfil:perfis!inner(slug)', { count: 'exact', head: true })
        .eq('ativo', true)
        .eq('perfis.slug', 'admin');
      if ((count ?? 0) <= 1) {
        return { ok: false, error: 'Não é possível desativar o único admin ativo.' };
      }
    }
  }

  const { data: updated, error } = await supabase
    .from('usuarios')
    .update({ ativo: novoAtivo })
    .eq('id', userId)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: 'Usuário não encontrado ou RLS bloqueou.' };

  revalidatePath('/admin/usuarios');
  return { ok: true };
}
