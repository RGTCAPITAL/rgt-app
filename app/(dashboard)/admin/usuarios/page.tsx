import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { UsuariosLista, type UsuarioRow } from './usuarios-lista';

export default async function AdminUsuariosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: meuPerfil } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();

  if (meuPerfil?.perfil?.slug !== 'admin') redirect('/');

  const { data: usuarios } = await supabase
    .from('usuarios')
    .select('id, email, nome, ativo, created_at, perfil:perfis(slug)')
    .order('created_at', { ascending: true })
    .returns<
      {
        id: string;
        email: string;
        nome: string | null;
        ativo: boolean;
        created_at: string;
        perfil: { slug: string } | null;
      }[]
    >();

  const rows: UsuarioRow[] = (usuarios ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    nome: u.nome,
    ativo: u.ativo,
    created_at: u.created_at,
    perfil_slug: u.perfil?.slug ?? null,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Usuários</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {rows.length} usuário{rows.length === 1 ? '' : 's'} cadastrado{rows.length === 1 ? '' : 's'}.
          Só você (admin) vê essa tela.
        </p>
      </div>

      <UsuariosLista usuarios={rows} meuId={user.id} />
    </div>
  );
}
