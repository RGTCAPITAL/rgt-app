import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { NotifSino, type Notif } from './notif-sino';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';
import { Breadcrumbs } from './breadcrumbs';
import { AvisoDadosExemplo } from './aviso-dados-exemplo';
import { AvisosAoVivo } from './avisos-ao-vivo';
import { MenuMovel } from './menu-movel';

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
  // O menu decide item a item pelo perfil: gestão vê Regras, Robô etc., que as
  // páginas aceitam, mas não Usuários, que é só de admin.
  const perfil = meuPerfil?.perfil?.slug ?? null;

  return (
    <div className="flex min-h-screen">
      {/* Barra lateral só a partir de lg (1024px). Abaixo disso o MenuMovel do
          cabeçalho abre a mesma navegação em gaveta. Sticky: em página longa
          (prospecção, operação) o menu não some ao rolar. */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col justify-between overflow-y-auto border-r border-neutral-200 bg-white p-4 lg:flex">
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
          <SidebarNav perfil={perfil} />
        </div>
        <div className="border-t border-neutral-200 pt-3">
          <UserMenu email={user.email ?? ''} />
        </div>
      </aside>
      {/* min-w-0: sem ele, item de flex não encolhe abaixo do conteúdo, e uma
          tabela larga (prospecção, operações) esticava a página inteira para
          além da tela em vez de rolar dentro do próprio overflow-x-auto. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-2 sm:px-6 sm:py-3">
          <div className="flex min-w-0 items-center gap-1">
            <MenuMovel perfil={perfil} email={user.email ?? ''} />
            <Breadcrumbs />
          </div>
          <NotifSino notifs={notifs ?? []} />
          <AvisosAoVivo userId={user.id} />
        </header>
        <main className="p-4 sm:p-6 lg:p-10 xl:p-12">
          <AvisoDadosExemplo />
          {children}
        </main>
      </div>
    </div>
  );
}
