'use client';

import { useState, useTransition } from 'react';
import { mudarStatusLead } from './actions';
import { STATUS_LEAD, labelOrigem, type StatusLead } from '@/lib/leads';

export type LeadCard = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  origem: string;
  status: StatusLead;
  created_at: string;
  motivo_perda: string | null;
  operacao_id: string | null;
  dono: { nome: string | null } | null;
};

function fmtRel(iso: string): string {
  const d = new Date(iso);
  const diffH = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60));
  if (diffH < 1) return 'agora';
  if (diffH < 24) return `${diffH}h`;
  const dd = Math.floor(diffH / 24);
  if (dd < 30) return `${dd}d`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function iniciais(nome: string | null): string {
  if (!nome) return '?';
  return nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

export function Kanban({ leads }: { leads: LeadCard[] }) {
  const [erro, setErro] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<StatusLead | null>(null);
  const [modalPerdido, setModalPerdido] = useState<{ leadId: string; nome: string } | null>(null);
  const [motivoPerda, setMotivoPerda] = useState('');
  const [_, startTransition] = useTransition();

  function onDragStart(e: React.DragEvent, leadId: string) {
    e.dataTransfer.setData('text/plain', leadId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: React.DragEvent, col: StatusLead) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(col);
  }

  function onDragLeave() {
    setDragOverCol(null);
  }

  function onDrop(e: React.DragEvent, novoStatus: StatusLead) {
    e.preventDefault();
    setDragOverCol(null);
    const leadId = e.dataTransfer.getData('text/plain');
    if (!leadId) return;

    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === novoStatus) return;

    // "Perdido" abre modal pra pegar motivo
    if (novoStatus === 'perdido') {
      setModalPerdido({ leadId, nome: lead.nome });
      setMotivoPerda('');
      return;
    }

    aplicarStatus(leadId, novoStatus);
  }

  function aplicarStatus(leadId: string, novoStatus: StatusLead, motivo?: string) {
    setErro(null);
    startTransition(async () => {
      const res = await mudarStatusLead(leadId, novoStatus, motivo);
      if (!res.ok) setErro(res.error);
    });
  }

  function confirmarPerda() {
    if (!modalPerdido) return;
    if (!motivoPerda.trim()) {
      setErro('Informe o motivo da perda.');
      return;
    }
    aplicarStatus(modalPerdido.leadId, 'perdido', motivoPerda);
    setModalPerdido(null);
  }

  return (
    <div>
      {erro && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {erro}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-6">
        {STATUS_LEAD.map((col) => {
          const leadsDaCol = leads.filter((l) => l.status === col.value);
          const highlight = dragOverCol === col.value;
          return (
            <div
              key={col.value}
              onDragOver={(e) => onDragOver(e, col.value)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, col.value)}
              className={`flex min-h-[60vh] flex-col rounded-md border bg-neutral-50 p-2 transition-colors ${
                highlight ? 'border-neutral-900 bg-neutral-100' : 'border-neutral-200'
              }`}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${col.cor}`}>
                  {col.label}
                </span>
                <span className="text-xs text-neutral-500">{leadsDaCol.length}</span>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto">
                {leadsDaCol.length === 0 ? (
                  <div className="mt-4 text-center text-xs text-neutral-400">—</div>
                ) : (
                  leadsDaCol.map((lead) => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, lead.id)}
                      className="cursor-grab rounded-md border border-neutral-200 bg-white p-3 text-sm shadow-sm hover:shadow active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-neutral-900">{lead.nome}</span>
                        <span className="text-[10px] text-neutral-400">{fmtRel(lead.created_at)}</span>
                      </div>
                      {(lead.telefone || lead.email) && (
                        <div className="mt-1 text-xs text-neutral-600">
                          {lead.telefone && <span>{lead.telefone}</span>}
                          {lead.telefone && lead.email && <span className="mx-1">·</span>}
                          {lead.email && <span className="break-all">{lead.email}</span>}
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                          {labelOrigem(lead.origem)}
                        </span>
                        {lead.dono?.nome && (
                          <span
                            title={lead.dono.nome}
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-[9px] font-medium text-white"
                          >
                            {iniciais(lead.dono.nome)}
                          </span>
                        )}
                      </div>
                      {lead.status === 'perdido' && lead.motivo_perda && (
                        <p className="mt-2 border-l-2 border-red-300 pl-2 text-[11px] italic text-neutral-600">
                          {lead.motivo_perda}
                        </p>
                      )}
                      {lead.status === 'ganho' && lead.operacao_id && (
                        <a
                          href={`/operacoes/${lead.operacao_id}`}
                          className="mt-2 inline-block text-[11px] text-emerald-700 underline"
                        >
                          → Ver operação
                        </a>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {modalPerdido && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
          onClick={() => setModalPerdido(null)}
        >
          <div
            className="w-full max-w-md rounded-md border border-neutral-200 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-neutral-900">Marcar como perdido</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Lead: <strong>{modalPerdido.nome}</strong>
            </p>
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-neutral-700">Motivo *</span>
              <textarea
                value={motivoPerda}
                onChange={(e) => setMotivoPerda(e.target.value)}
                rows={3}
                placeholder="Ex: cliente desistiu, valor abaixo do mínimo, fora do ICP"
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
                autoFocus
              />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalPerdido(null)}
                className="rounded-md px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarPerda}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Confirmar perda
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
