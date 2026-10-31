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
  conversas: 'Conversas',
  robo: 'Robô',
  prospeccao: 'Prospecção',
  importar: 'Importar',
  'buscar-por-nome': 'Buscar por nome',
  mensagens: 'Mensagens',
  indices: 'Índices',
  desagio: 'Percentual',
  regras: 'Regras',
  precificacao: 'Precificação',
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
    // No celular só a página atual: a trilha inteira não cabe ao lado do
    // botão de menu e do sino.
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1 text-sm text-neutral-500"
    >
      {crumbs.map((c, i) => (
        <span
          key={c.href}
          className={
            c.last ? 'flex min-w-0 items-center gap-1' : 'hidden items-center gap-1 sm:flex'
          }
        >
          {i > 0 && <ChevronRight className="hidden size-3.5 shrink-0 text-neutral-400 sm:block" />}
          {c.last ? (
            <span className="truncate font-medium text-neutral-900">{c.label}</span>
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
