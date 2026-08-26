import { createClient } from '@/lib/supabase/server';

type UsuarioComPerfil = {
  nome: string | null;
  ativo: boolean;
  perfis: { slug: string; nome: string } | null;
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Buscar perfil do usuário logado
  const { data: usuario } = user
    ? await supabase
        .from('usuarios')
        .select('nome, ativo, perfis(slug, nome)')
        .eq('id', user.id)
        .single<UsuarioComPerfil>()
    : { data: null };

  const perfil = usuario?.perfis ?? null;

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold tracking-tight">Bem-vindo</h1>
      <p className="mt-2 text-neutral-600">
        {usuario?.nome ? `Oi, ${usuario.nome}.` : 'Você está logado.'}
      </p>

      <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Seu acesso
        </h2>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-neutral-500">Email</dt>
          <dd className="font-mono">{user?.email}</dd>
          <dt className="text-neutral-500">Nome</dt>
          <dd>{usuario?.nome ?? <span className="text-neutral-400">não definido</span>}</dd>
          <dt className="text-neutral-500">Perfil</dt>
          <dd>
            {perfil ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-xs">
                {perfil.slug}
              </span>
            ) : (
              <span className="text-amber-700">
                Sem perfil — admin precisa definir seu acesso antes de você usar o sistema
              </span>
            )}
          </dd>
          <dt className="text-neutral-500">Ativo</dt>
          <dd>{usuario?.ativo ? 'sim' : 'não'}</dd>
        </dl>
      </section>

      {!perfil && (
        <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <h3 className="font-semibold">⚠️ Aguardando definição de perfil</h3>
          <p className="mt-2">
            Sua conta foi criada mas ainda não tem perfil atribuído. Peça pro admin
            executar no Supabase SQL Editor:
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-white p-3 text-xs text-neutral-800">
{`UPDATE usuarios
SET perfil_id = (SELECT id FROM perfis WHERE slug = 'admin')
WHERE email = '${user?.email}';`}
          </pre>
        </section>
      )}
    </div>
  );
}
