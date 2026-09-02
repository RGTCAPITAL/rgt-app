'use client';

import { useState, useTransition } from 'react';
import { ArrowRight } from 'lucide-react';
import { criarLead, atualizarLead } from './actions';
import { ORIGEM_LEAD, STATUS_LEAD } from '@/lib/leads';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type DonoOption = { id: string; nome: string | null };

export type LeadEdit = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  cpf_cnpj: string | null;
  origem: string;
  dono_id: string | null;
  notas: string | null;
  status: string;
  operacao_id: string | null;
  motivo_perda: string | null;
};

type Props = {
  aberto: boolean;
  onClose: () => void;
  donos: DonoOption[];
  meuId: string;
  isAdmin: boolean;
  editando?: LeadEdit;
};

function fmtTelefone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 13);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
}

function fmtCpfCnpj(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  if (d.length <= 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function LeadForm({ aberto, onClose, donos, meuId, isAdmin, editando }: Props) {
  const [nome, setNome] = useState(editando?.nome ?? '');
  const [telefone, setTelefone] = useState(fmtTelefone(editando?.telefone ?? ''));
  const [email, setEmail] = useState(editando?.email ?? '');
  const [cpfCnpj, setCpfCnpj] = useState(fmtCpfCnpj(editando?.cpf_cnpj ?? ''));
  const [origem, setOrigem] = useState<string>(editando?.origem ?? '');
  const [donoId, setDonoId] = useState(editando?.dono_id ?? (isAdmin ? '' : meuId));
  const [notas, setNotas] = useState(editando?.notas ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function salvar() {
    setErro(null);
    if (!nome.trim() || !origem) {
      setErro('Nome e origem são obrigatórios.');
      return;
    }
    const payload = {
      nome: nome.trim(),
      telefone,
      email: email.trim(),
      cpf_cnpj: cpfCnpj,
      origem,
      dono_id: donoId,
      notas: notas.trim(),
    };

    startTransition(async () => {
      const res = editando ? await atualizarLead(editando.id, payload) : await criarLead(payload);
      if (!res.ok) {
        setErro(res.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar lead' : 'Novo lead'}</DialogTitle>
        </DialogHeader>

        {editando && <StatusVinculo lead={editando} />}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nome *" full>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              disabled={pending}
              autoFocus
            />
          </Field>
          <Field label="Telefone">
            <Input
              value={telefone}
              onChange={(e) => setTelefone(fmtTelefone(e.target.value))}
              disabled={pending}
              placeholder="(82) 99123-4567"
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
            />
          </Field>
          <Field label="CPF / CNPJ">
            <Input
              value={cpfCnpj}
              onChange={(e) => setCpfCnpj(fmtCpfCnpj(e.target.value))}
              disabled={pending}
              placeholder="000.000.000-00"
            />
          </Field>
          <Field label="Origem *">
            <select
              value={origem}
              onChange={(e) => setOrigem(e.target.value)}
              disabled={pending}
              className="h-9 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-900"
            >
              <option value="">Selecione…</option>
              {ORIGEM_LEAD.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {isAdmin && (
            <Field label="Dono">
              <select
                value={donoId}
                onChange={(e) => setDonoId(e.target.value)}
                disabled={pending}
                className="h-9 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-900"
              >
                <option value="">— sem dono —</option>
                {donos.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nome ?? '—'}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Notas" full>
            <Textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              disabled={pending}
              placeholder="Contexto: como surgiu, o que tem, próximos passos"
            />
          </Field>
        </div>

        {erro && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            {erro}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pending || !nome.trim() || !origem}>
            {pending ? 'Salvando…' : editando ? 'Salvar alterações' : 'Criar lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', full && 'sm:col-span-2')}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function StatusVinculo({ lead }: { lead: LeadEdit }) {
  const stat = STATUS_LEAD.find((s) => s.value === lead.status);
  const podeConverter = lead.status === 'qualificado' || lead.status === 'proposta_enviada';
  const jaGanho = lead.status === 'ganho' && lead.operacao_id;
  const perdido = lead.status === 'perdido' && lead.motivo_perda;

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Status:</span>
          <Badge
            className={cn('border-transparent', stat?.cor ?? 'bg-neutral-100 text-neutral-700')}
          >
            {stat?.label ?? lead.status}
          </Badge>
        </div>
        {podeConverter && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    buttonVariants({ size: 'sm' }),
                    'bg-emerald-600 text-white hover:bg-emerald-700',
                  )}
                />
              }
            >
              Virar operação
              <ArrowRight className="size-3.5" />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Converter em operação?</AlertDialogTitle>
                <AlertDialogDescription>
                  Você será levado ao formulário de nova operação com nome e CPF do lead
                  <strong className="text-neutral-900"> {lead.nome} </strong>
                  pré-preenchidos. Se salvar, o lead vira <strong>ganho</strong> e fica vinculado à
                  operação.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  render={
                    <a
                      href={`/operacoes/nova?lead_id=${lead.id}`}
                      className="bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      Ir para o formulário
                    </a>
                  }
                />
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {jaGanho && (
          <a
            href={`/operacoes/${lead.operacao_id}`}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'border-emerald-300 text-emerald-700 hover:bg-emerald-50',
            )}
          >
            Ver operação vinculada
            <ArrowRight className="size-3.5" />
          </a>
        )}
      </div>
      {perdido && (
        <p className="mt-2 border-l-2 border-red-300 pl-2 text-xs text-neutral-600 italic">
          Motivo: {lead.motivo_perda}
        </p>
      )}
    </div>
  );
}
