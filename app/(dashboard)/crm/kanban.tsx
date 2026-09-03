'use client';

import { useState, useTransition } from 'react';
import { ArrowRight } from 'lucide-react';
import { mudarStatusLead } from './actions';
import { STATUS_LEAD, labelOrigem, type StatusLead } from '@/lib/leads';
import { LeadForm, type DonoOption, type LeadEdit } from './lead-form';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type LeadCard = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  cpf_cnpj: string | null;
  origem: string;
  status: StatusLead;
  created_at: string;
  motivo_perda: string | null;
  operacao_id: string | null;
  dono_id: string | null;
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
  return nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

const COLUNA_BORDER: Record<string, string> = {
  novo: 'border-t-neutral-400',
  em_contato: 'border-t-blue-500',
  qualificado: 'border-t-amber-500',
  proposta_enviada: 'border-t-violet-500',
  ganho: 'border-t-emerald-500',
  perdido: 'border-t-rose-500',
};

export function Kanban({
  leads,
  donos,
  meuId,
  isAdmin,
  abrirNovo,
  onNovoFechado,
}: {
  leads: LeadCard[];
  donos: DonoOption[];
  meuId: string;
  isAdmin: boolean;
  abrirNovo: boolean;
  onNovoFechado: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<StatusLead | null>(null);
  const [modalPerdido, setModalPerdido] = useState<{ leadId: string; nome: string } | null>(null);
  const [motivoPerda, setMotivoPerda] = useState('');
  const [editandoLead, setEditandoLead] = useState<LeadEdit | null>(null);
  const [, startTransition] = useTransition();

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
              className={cn(
                'flex min-h-[60vh] flex-col rounded-lg border border-t-4 bg-white/70 p-2 transition-colors',
                COLUNA_BORDER[col.value] ?? 'border-t-neutral-400',
                highlight ? 'border-neutral-900 bg-neutral-100' : 'border-neutral-200',
              )}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <Badge
                  className={cn(
                    'border-transparent',
                    leadsDaCol.length === 0 ? col.corVazio : col.cor,
                  )}
                >
                  {col.label}
                </Badge>
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
                      onClick={() =>
                        setEditandoLead({
                          id: lead.id,
                          nome: lead.nome,
                          telefone: lead.telefone,
                          email: lead.email,
                          cpf_cnpj: lead.cpf_cnpj,
                          origem: lead.origem,
                          dono_id: lead.dono_id,
                          notas: null,
                          status: lead.status,
                          operacao_id: lead.operacao_id,
                          motivo_perda: lead.motivo_perda,
                        })
                      }
                      className="group cursor-grab rounded-lg bg-white p-3 text-sm shadow-sm ring-1 ring-neutral-200 transition-shadow hover:shadow-md active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-neutral-900">{lead.nome}</span>
                        <span className="text-[10px] text-neutral-400">
                          {fmtRel(lead.created_at)}
                        </span>
                      </div>
                      {(lead.telefone || lead.email) && (
                        <div className="mt-1 text-xs text-neutral-600">
                          {lead.telefone && <span>{lead.telefone}</span>}
                          {lead.telefone && lead.email && <span className="mx-1">·</span>}
                          {lead.email && <span className="break-all">{lead.email}</span>}
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {labelOrigem(lead.origem)}
                        </Badge>
                        {lead.dono?.nome && (
                          <span
                            title={lead.dono.nome}
                            className="flex size-5 items-center justify-center rounded-full bg-neutral-900 text-[9px] font-medium text-white"
                          >
                            {iniciais(lead.dono.nome)}
                          </span>
                        )}
                      </div>
                      {(lead.status === 'qualificado' || lead.status === 'proposta_enviada') && (
                        <a
                          href={`/operacoes/nova?lead_id=${lead.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className={cn(
                            buttonVariants({ size: 'xs' }),
                            'mt-2 w-full bg-emerald-600 text-white hover:bg-emerald-700',
                          )}
                        >
                          Virar operação
                          <ArrowRight className="size-3" />
                        </a>
                      )}
                      {lead.status === 'perdido' && lead.motivo_perda && (
                        <p className="mt-2 border-l-2 border-red-300 pl-2 text-[11px] text-neutral-600 italic">
                          {lead.motivo_perda}
                        </p>
                      )}
                      {lead.status === 'ganho' && lead.operacao_id && (
                        <a
                          href={`/operacoes/${lead.operacao_id}`}
                          onClick={(e) => e.stopPropagation()}
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

      <LeadForm
        aberto={abrirNovo}
        onClose={onNovoFechado}
        donos={donos}
        meuId={meuId}
        isAdmin={isAdmin}
      />

      {editandoLead && (
        <LeadForm
          aberto={true}
          onClose={() => setEditandoLead(null)}
          donos={donos}
          meuId={meuId}
          isAdmin={isAdmin}
          editando={editandoLead}
        />
      )}

      <Dialog open={!!modalPerdido} onOpenChange={(open) => !open && setModalPerdido(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como perdido</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-neutral-600">
            Lead: <strong className="text-neutral-900">{modalPerdido?.nome}</strong>
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="motivo-perda">Motivo *</Label>
            <Textarea
              id="motivo-perda"
              value={motivoPerda}
              onChange={(e) => setMotivoPerda(e.target.value)}
              rows={3}
              placeholder="Ex: cliente desistiu, valor abaixo do mínimo, fora do ICP"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setModalPerdido(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmarPerda}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Confirmar perda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
