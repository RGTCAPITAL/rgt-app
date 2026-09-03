'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { Kanban, type LeadCard } from './kanban';
import type { DonoOption } from './lead-form';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  leads: LeadCard[];
  donos: DonoOption[];
  meuId: string;
  isAdmin: boolean;
  podeImportar: boolean;
};

export function CrmShell({ leads, donos, meuId, isAdmin, podeImportar }: Props) {
  const [novoAberto, setNovoAberto] = useState(false);

  return (
    <>
      <div className="mb-4 flex justify-end gap-2">
        {podeImportar && (
          <Link href="/crm/importar" className={cn(buttonVariants({ variant: 'outline' }))}>
            <Upload className="size-4" />
            Importar CSV
          </Link>
        )}
        <button
          type="button"
          onClick={() => setNovoAberto(true)}
          className={cn(buttonVariants({ variant: 'default' }))}
        >
          <Plus className="size-4" />
          Novo lead
        </button>
      </div>

      <Kanban
        leads={leads}
        donos={donos}
        meuId={meuId}
        isAdmin={isAdmin}
        abrirNovo={novoAberto}
        onNovoFechado={() => setNovoAberto(false)}
      />
    </>
  );
}
