import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { NotifSino, type Notif } from './notif-sino';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';
import { Breadcrumbs } from './breadcrumbs';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
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
  const isAdmin = meuPerfil?.perfil?.slug === 'admin';

  const { data: notifs } = await supabase
    .from('notificacoes')
    .select('id, tipo, titulo, descricao, link, lida_em, created_at')
    .eq('destinatario', user.id)
    .order('created_at', { ascending: false })
    .limit(10)
    .returns<Notif[]>();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col justify-between border-r border-neutral-200 bg-white p-4">
        <div>
          <div className="mb-8 px-2 text-lg font-bold tracking-tight">
            rgt <span className="text-neutral-400">app</span>
          </div>
          <SidebarNav isAdmin={isAdmin} />
        </div>
        <div className="border-t border-neutral-200 pt-3">
          <UserMenu email={user.email ?? ''} />
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
          <Breadcrumbs />
          <NotifSino notifs={notifs ?? []} />
        </header>
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
