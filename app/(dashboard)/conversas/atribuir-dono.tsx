'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import { atribuirDono } from './actions';

/**
 * Admin e gestão distribuem a conversa ali mesmo. Com ~15 contatos novos por
 * dia chegando sem dono (dado do Renato, 28/10), abrir o CRM pra cada um não
 * escala. O dono é o do lead: é ele que faz a conversa aparecer pro broker.
 */
export function AtribuirDono({
  leadId,
  donoId,
  donos,
  desligado,
}: {
  leadId: string;
  donoId: string | null;
  donos: { id: string; nome: string | null }[];
  desligado?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-600">
      <span className="shrink-0">Dono:</span>
      <select
        value={donoId ?? ''}
        disabled={pending || desligado}
        onChange={(e) => {
          const novo = e.target.value;
          if (!novo) return;
          startTransition(async () => {
            const r = await atribuirDono(leadId, novo);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            toast.success('Conversa atribuída. O broker foi avisado.');
            router.refresh();
          });
        }}
        className={`max-w-[11rem] truncate rounded-md border px-2 py-1 text-xs ${
          donoId
            ? 'border-neutral-200 bg-white'
            : 'border-amber-300 bg-amber-50 font-medium text-amber-900'
        }`}
      >
        {!donoId && <option value="">Sem dono — escolher</option>}
        {donos.map((d) => (
          <option key={d.id} value={d.id}>
            {d.nome ?? 'Sem nome'}
          </option>
        ))}
      </select>
      {pending && <Spinner />}
    </label>
  );
}
