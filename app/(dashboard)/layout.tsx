import Image from 'next/image';
import Link from 'next/link';
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

  // Perfil e notificações não dependem um do outro — em série custavam ~50-100ms
  // extras em TODA navegação do app, porque o layout roda a cada troca de rota.
  const [{ data: meuPerfil }, { data: notifs }] = await Promise.all([
    supabase
      .from('usuarios')
      .select('perfil:perfis(slug)')
      .eq('id', user.id)
      .single<{ perfil: { slug: string } | null }>(),
    supabase
      .from('notificacoes')
      .select('id, tipo, titulo, descricao, link, lida_em, created_at')
      .eq('destinatario', user.id)
      .order('created_at', { ascending: false })
      .limit(10)
      .returns<Notif[]>(),
  ]);
  const isAdmin = meuPerfil?.perfil?.slug === 'admin';

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col justify-between border-r border-neutral-200 bg-white p-4">
        <div>
          {/* Logo horizontal oficial (kit do Humberto). Mesmo arquivo do site,
              pra manter consistência da marca entre canal público e interno. */}
          <Link href="/" className="mb-8 block px-2" aria-label="Ir para o início">
            <Image
              src="/logo-header.png"
              alt="RGT Capital"
              width={175}
              height={48}
              priority
              className="h-10 w-auto"
            />
          </Link>
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
        <main className="p-10 lg:p-12">{children}</main>
      </div>
    </div>
  );
}
