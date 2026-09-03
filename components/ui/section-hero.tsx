import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Section Hero banner — cabeçalho grande colorido no topo da página.
 * Inspiração: cabeçalhos coloridos da plataforma Lajedo (verde/azul vivos).
 */
export function SectionHero({
  title,
  subtitle,
  color = 'emerald',
  action,
}: {
  title: string;
  subtitle?: string;
  color?: 'emerald' | 'blue' | 'amber' | 'violet' | 'neutral';
  action?: React.ReactNode;
}) {
  const bgClasses: Record<string, string> = {
    emerald: 'bg-gradient-to-br from-emerald-600 to-emerald-700',
    blue: 'bg-gradient-to-br from-blue-600 to-blue-700',
    amber: 'bg-gradient-to-br from-amber-500 to-amber-600',
    violet: 'bg-gradient-to-br from-violet-600 to-violet-700',
    neutral: 'bg-gradient-to-br from-neutral-800 to-neutral-900',
  };

  return (
    <div
      className={cn(
        'mb-8 flex flex-wrap items-center justify-between gap-4 rounded-xl px-6 py-6 text-white shadow-lg',
        bgClasses[color],
      )}
    >
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-white/85">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

/**
 * KPI card com ícone circular colorido (padrão Lajedo).
 * Cada KPI ganha uma cor semântica no ícone E no valor.
 */
export function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  color = 'neutral',
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  color?: 'emerald' | 'blue' | 'amber' | 'violet' | 'rose' | 'neutral';
  href?: string;
}) {
  const iconClasses: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
    rose: 'bg-rose-50 text-rose-600',
    neutral: 'bg-neutral-100 text-neutral-600',
  };
  const valueClasses: Record<string, string> = {
    emerald: 'text-emerald-700',
    blue: 'text-blue-700',
    amber: 'text-amber-700',
    violet: 'text-violet-700',
    rose: 'text-rose-700',
    neutral: 'text-neutral-900',
  };

  const inner = (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="min-w-0">
        <div className="text-sm font-medium text-neutral-600">{label}</div>
        <div className={cn('mt-2 text-3xl font-bold', valueClasses[color])}>{value}</div>
        {sub && <div className="mt-1 text-xs text-neutral-500">{sub}</div>}
      </div>
      <div
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-full',
          iconClasses[color],
        )}
      >
        <Icon className="size-5" />
      </div>
    </div>
  );

  if (href) {
    return (
      <a href={href} className="block">
        {inner}
      </a>
    );
  }
  return inner;
}

/**
 * Funil horizontal — barra colorida full-width mostrando um estágio,
 * com número grande em branco. Padrão do Lajedo.
 */
export function FunilBarra({
  label,
  count,
  color = 'emerald',
}: {
  label: string;
  count: number;
  color?: 'emerald' | 'amber' | 'blue' | 'violet' | 'rose';
}) {
  const bg: Record<string, string> = {
    emerald: 'bg-emerald-600',
    amber: 'bg-amber-500',
    blue: 'bg-blue-600',
    violet: 'bg-violet-600',
    rose: 'bg-rose-600',
  };
  return (
    <div className={cn('flex items-center justify-between rounded-lg px-5 py-4 text-white', bg[color])}>
      <div>
        <div className="text-xs font-medium tracking-wide uppercase opacity-90">{label}</div>
        <div className="mt-1 text-2xl font-bold">{count}</div>
      </div>
    </div>
  );
}
