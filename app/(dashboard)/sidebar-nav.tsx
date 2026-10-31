'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Home,
  Users,
  Briefcase,
  CheckSquare,
  Shield,
  Search,
  TrendingUp,
  MessageSquare,
  MessagesSquare,
  Percent,
  Bot,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/lib/auth/roles';

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const NAV_BASE: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: Home },
  { label: 'Prospecção', href: '/admin/prospeccao', icon: Search },
  { label: 'CRM', href: '/crm', icon: Users },
  { label: 'Conversas', href: '/conversas', icon: MessagesSquare },
  { label: 'Operações', href: '/operacoes', icon: Briefcase },
  { label: 'Tarefas', href: '/tarefas', icon: CheckSquare },
];

/**
 * `perfis` copia quem a página aceita (o gate dela): item que a pessoa não
 * pode abrir não aparece, e página que aceita gestão não fica escondida dela.
 * Mudou o gate da página, muda aqui.
 */
export const NAV_ADMIN: (NavItem & { perfis: readonly Role[] })[] = [
  { label: 'Usuários', href: '/admin/usuarios', icon: Shield, perfis: ['admin'] },
  {
    label: 'Mensagens',
    href: '/admin/mensagens',
    icon: MessageSquare,
    perfis: ['admin', 'gestao'],
  },
  { label: 'Robô', href: '/admin/robo', icon: Bot, perfis: ['admin', 'gestao'] },
  { label: 'Regras', href: '/admin/regras', icon: Workflow, perfis: ['admin', 'gestao'] },
  { label: 'Índices', href: '/admin/indices', icon: TrendingUp, perfis: ['admin', 'gestao'] },
  { label: 'Percentual', href: '/admin/desagio', icon: Percent, perfis: ['admin', 'gestao'] },
];

function itemAtivo(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ perfil }: { perfil: string | null }) {
  const pathname = usePathname();
  const admin = NAV_ADMIN.filter((item) => item.perfis.some((p) => p === perfil));

  return (
    <nav className="flex flex-col gap-1">
      {NAV_BASE.map((item) => (
        <NavLink key={item.href} item={item} active={itemAtivo(pathname, item.href)} />
      ))}
      {admin.length > 0 && (
        <>
          <div className="my-2 border-t border-neutral-200" />
          {admin.map((item) => (
            <NavLink key={item.href} item={item} active={itemAtivo(pathname, item.href)} />
          ))}
        </>
      )}
    </nav>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        'relative flex items-center gap-2 rounded-md px-3 py-2.5 text-sm transition-colors',
        active
          ? 'bg-emerald-50 font-semibold text-emerald-700'
          : 'text-neutral-700 hover:bg-neutral-100',
      )}
    >
      <Icon className="size-4" />
      <span>{item.label}</span>
    </Link>
  );
}
