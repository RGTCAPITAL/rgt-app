'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

const LABELS: Record<string, string> = {
  '': 'Dashboard',
  crm: 'CRM',
  novo: 'Novo',
  operacoes: 'Operações',
  nova: 'Nova',
  tarefas: 'Tarefas',
  admin: 'Admin',
  usuarios: 'Usuários',
};

type Crumb = { href: string; label: string; last: boolean };

function trilha(pathname: string): Crumb[] {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return [{ href: '/', label: 'Dashboard', last: true }];

  const crumbs: Crumb[] = [{ href: '/', label: 'Dashboard', last: false }];
  let acc = '';
  parts.forEach((seg, i) => {
    acc += `/${seg}`;
    const isLast = i === parts.length - 1;
    // Se o segmento parece um UUID/id longo, usa "Detalhe" como label
    const looksLikeId = /^[0-9a-f-]{8,}$/i.test(seg) || /^\d+$/.test(seg);
    const label = looksLikeId ? 'Detalhe' : (LABELS[seg] ?? seg);
    crumbs.push({ href: acc, label, last: isLast });
  });

  return crumbs;
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = trilha(pathname);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-neutral-500">
      {crumbs.map((c, i) => (
        <span key={c.href} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3.5 text-neutral-400" />}
          {c.last ? (
            <span className="font-medium text-neutral-900">{c.label}</span>
          ) : (
            <Link href={c.href} className="transition-colors hover:text-neutral-900">
              {c.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
