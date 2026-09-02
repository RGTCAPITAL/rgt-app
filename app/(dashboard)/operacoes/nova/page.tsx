import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { NovaOperacaoForm } from './nova-operacao-form';
import type { Esfera } from '@/lib/tribunais';

export default async function NovaOperacaoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug, permissoes)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string; permissoes: Record<string, unknown> | null } | null }>();

  const podeMunicipal = Boolean(usuario?.perfil?.permissoes?.['pode_esfera_municipal']);

  const { data: entes } = await supabase
    .from('entes_devedores')
    .select('id, nome, esfera, uf')
    .eq('ativo', true)
    .order('esfera')
    .order('nome')
    .returns<{ id: string; nome: string; esfera: Esfera; uf: string | null }[]>();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nova operação</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Cadastre um precatório, RPV ou direito creditório em 3 passos.
          </p>
        </div>
        <Link
          href="/operacoes"
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Cancelar
        </Link>
      </div>

      <NovaOperacaoForm entesDevedores={entes ?? []} podeMunicipal={podeMunicipal} />
    </div>
  );
}
