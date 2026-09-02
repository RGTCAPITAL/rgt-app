import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Spinner leve reutilizável — Loader2 lucide com animate-spin.
 * Usa currentColor por padrão pra herdar cor do parent (bom pra botões).
 */
export function Spinner({
  className,
  size = 4,
}: {
  className?: string;
  size?: 3 | 4 | 5 | 6 | 8;
}) {
  return (
    <Loader2 className={cn(`size-${size} animate-spin`, className)} aria-hidden />
  );
}
