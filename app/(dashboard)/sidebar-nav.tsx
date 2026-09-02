'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Home, Users, Briefcase, CheckSquare, Shield, type LucideIcon } from 'lucide-react';

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const NAV_BASE: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: Home },
  { label: 'CRM', href: '/crm', icon: Users },
  { label: 'Operações', href: '/operacoes', icon: Briefcase },
  { label: 'Tarefas', href: '/tarefas', icon: CheckSquare },
];

export const NAV_ADMIN: NavItem[] = [{ label: 'Usuários', href: '/admin/usuarios', icon: Shield }];

function itemAtivo(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? [...NAV_BASE, ...NAV_ADMIN] : NAV_BASE;

  return (
    <nav className="flex flex-col gap-1">
      {NAV_BASE.map((item) => (
        <NavLink key={item.href} item={item} active={itemAtivo(pathname, item.href)} />
      ))}
      {isAdmin && (
        <>
          <div className="my-2 border-t border-neutral-200" />
          {NAV_ADMIN.map((item) => (
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
        'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-primary text-primary-foreground font-medium'
          : 'text-neutral-700 hover:bg-neutral-100',
      )}
    >
      <Icon className="size-4" />
      <span>{item.label}</span>
    </Link>
  );
}
