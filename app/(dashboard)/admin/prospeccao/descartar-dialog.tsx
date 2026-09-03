'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { descartarProspeccao } from './actions';

type Row = {
  id: string;
  numero_processo: string;
};

type Props = {
  row: Row;
  onClose: () => void;
  onSuccess: () => void;
};

const MOTIVOS_COMUNS = [
  'Credor já vendeu pra outro',
  'Sem interesse em vender',
  'Credor falecido',
  'Processo tem red flag crítico',
  'Fora do ICP (valor muito baixo)',
];

export function DescartarDialog({ row, onClose, onSuccess }: Props) {
  const [motivo, setMotivo] = useState('');
  const [pending, startTransition] = useTransition();

  function submeter() {
    if (!motivo.trim() || motivo.trim().length < 3) {
      toast.error('Motivo é obrigatório.');
      return;
    }
    startTransition(async () => {
      const res = await descartarProspeccao(row.id, motivo);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Prospecção descartada.');
      onSuccess();
    });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="size-5 text-red-600" />
            Descartar prospecção
          </DialogTitle>
          <DialogDescription>
            Processo{' '}
            <code className="rounded bg-neutral-100 px-1 text-xs">{row.numero_processo}</code> vai
            sair da fila. Você pode reativar depois mudando o status.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="motivo">
              Motivo <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={pending}
              rows={3}
              placeholder="Ex: Credor já vendeu pra fundo X em 2025."
            />
            <div className="flex flex-wrap gap-1">
              {MOTIVOS_COMUNS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMotivo(m)}
                  className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-100"
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={submeter} disabled={pending}>
            {pending ? (
              <>
                <Spinner size={3} />
                Descartando…
              </>
            ) : (
              <>
                <XCircle className="size-4" />
                Descartar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
