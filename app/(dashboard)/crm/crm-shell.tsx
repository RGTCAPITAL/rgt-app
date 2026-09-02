'use client';

import { useState } from 'react';
import { Kanban, type LeadCard } from './kanban';
import type { DonoOption } from './lead-form';

type Props = {
  leads: LeadCard[];
  donos: DonoOption[];
  meuId: string;
  isAdmin: boolean;
};

export function CrmShell({ leads, donos, meuId, isAdmin }: Props) {
  const [novoAberto, setNovoAberto] = useState(false);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setNovoAberto(true)}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          + Novo lead
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
