import { createClient } from '@/lib/supabase/server';

export type Role = 'admin' | 'gestao' | 'juridico' | 'broker';

/**
 * Gate de perfil pra server actions.
 *
 * RLS continua sendo a barreira real no banco, mas actions que gastam dinheiro
 * (Judit cobra por consulta) ou disparam efeito externo precisam checar ANTES
 * de agir — RLS só barra na hora do INSERT, quando o crédito já foi debitado.
 * Também vale como defense-in-depth: a migration 016 provou que uma policy
 * pode ser afrouxada por acidente num refactor.
 */
export async function exigirPerfil(
  permitidos: readonly Role[],
): Promise<{ ok: true; userId: string; role: Role } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('ativo, perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ ativo: boolean; perfil: { slug: string } | null }>();

  if (!usuario?.ativo) return { ok: false, error: 'Usuário inativo.' };

  const role = usuario.perfil?.slug as Role | undefined;
  if (!role || !permitidos.includes(role)) {
    return { ok: false, error: 'Sem permissão para esta ação.' };
  }

  return { ok: true, userId: user.id, role };
}
