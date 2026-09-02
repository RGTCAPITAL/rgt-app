import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { NotifSino, type Notif } from './notif-sino';

const menuBase = [
  { label: 'Dashboard', href: '/' },
  { label: 'CRM', href: '/crm' },
  { label: 'Operações', href: '/operacoes' },
];

const menuAdmin = [{ label: 'Usuários', href: '/admin/usuarios' }];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: meuPerfil } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();
  const isAdmin = meuPerfil?.perfil?.slug === 'admin';
  const menu = isAdmin ? [...menuBase, ...menuAdmin] : menuBase;

  const { data: notifs } = await supabase
    .from('notificacoes')
    .select('id, tipo, titulo, descricao, link, lida_em, created_at')
    .eq('destinatario', user.id)
    .order('created_at', { ascending: false })
    .limit(10)
    .returns<Notif[]>();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col justify-between border-r border-neutral-200 bg-white p-6">
        <div>
          <div className="mb-8 text-lg font-bold tracking-tight">
            rgt <span className="text-neutral-400">app</span>
          </div>
          <nav className="flex flex-col gap-1">
            {menu.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="border-t border-neutral-200 pt-4">
          <div className="mb-2 truncate px-3 text-xs text-neutral-500" title={user.email ?? ''}>
            {user.email}
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="w-full rounded-md px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Sair
            </button>
          </form>
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end border-b border-neutral-200 bg-white px-6 py-2">
          <NotifSino notifs={notifs ?? []} />
        </header>
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
