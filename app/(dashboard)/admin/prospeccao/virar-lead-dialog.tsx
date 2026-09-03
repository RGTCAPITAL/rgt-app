'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { virarLead } from './actions';

type Row = {
  id: string;
  numero_processo: string;
  cedente_nome_provavel: string | null;
};

type Props = {
  row: Row;
  onClose: () => void;
  onSuccess: () => void;
};

export function VirarLeadDialog({ row, onClose, onSuccess }: Props) {
  const [nome, setNome] = useState(row.cedente_nome_provavel ?? '');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [notas, setNotas] = useState('');
  const [pending, startTransition] = useTransition();

  function submeter() {
    if (!nome.trim() || nome.trim().length < 2) {
      toast.error('Nome obrigatório.');
      return;
    }
    startTransition(async () => {
      const res = await virarLead(row.id, {
        nome,
        telefone: telefone.trim() || null,
        email: email.trim() || null,
        notas: notas.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Lead criado! Aparece agora no CRM.');
      onSuccess();
    });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-emerald-600" />
            Virar em lead
          </DialogTitle>
          <DialogDescription>
            Processo{' '}
            <code className="rounded bg-neutral-100 px-1 text-xs">{row.numero_processo}</code> vira
            row em <strong>leads</strong> com status &quot;Em contato&quot; e você como dono.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="lead-nome">
              Nome do credor <span className="text-red-500">*</span>
            </Label>
            <Input
              id="lead-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              disabled={pending}
              placeholder="Ex: João Silva"
            />
            {row.cedente_nome_provavel && (
              <p className="text-[11px] text-neutral-500">Pré-preenchido pela Judit.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="lead-tel">Telefone</Label>
              <Input
                id="lead-tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                disabled={pending}
                placeholder="82 99999-8888"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lead-email">E-mail</Label>
              <Input
                id="lead-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
                placeholder="joao@ex.com"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="lead-notas">Notas iniciais</Label>
            <Textarea
              id="lead-notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              disabled={pending}
              rows={3}
              placeholder="Ex: contato via advogado, ligou 03/09, tem interesse em vender."
            />
            <p className="text-[11px] text-neutral-500">
              Origem do processo + valor face são anexados automaticamente.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submeter} disabled={pending}>
            {pending ? (
              <>
                <Spinner size={3} />
                Criando…
              </>
            ) : (
              <>
                <UserPlus className="size-4" />
                Criar lead
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
