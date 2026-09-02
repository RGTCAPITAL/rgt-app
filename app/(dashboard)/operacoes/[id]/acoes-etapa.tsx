'use client';

import { useState, useTransition } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { mudarEtapa, registrarAceite } from './actions';
import { labelEtapa, transicoesPermitidas, type Etapa } from '@/lib/workflow';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

type Props = {
  operacaoId: string;
  etapaAtual: string;
  podeAvancar: boolean;
  precoAceito: boolean | null;
  precoProposto: number | null;
};

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function AcoesEtapa({
  operacaoId,
  etapaAtual,
  podeAvancar,
  precoAceito,
  precoProposto,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [novaEtapa, setNovaEtapa] = useState<Etapa | ''>('');
  const [observacao, setObservacao] = useState('');
  const [aceiteModalOpen, setAceiteModalOpen] = useState(false);
  const [precoInput, setPrecoInput] = useState(precoProposto ? String(precoProposto) : '');
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const opcoes = transicoesPermitidas(etapaAtual);
  const terminal = opcoes.length === 0;
  const emAceite = etapaAtual === 'aceite';

  function abrir() {
    setNovaEtapa(opcoes[0] ?? '');
    setObservacao('');
    setErro(null);
    setModalOpen(true);
  }

  function confirmar() {
    if (!novaEtapa) return;
    setErro(null);
    startTransition(async () => {
      const res = await mudarEtapa(operacaoId, novaEtapa, observacao);
      if (!res.ok) {
        setErro(res.error);
        return;
      }
      setModalOpen(false);
    });
  }

  function abrirAceite() {
    setErro(null);
    setPrecoInput(precoProposto ? String(precoProposto) : '');
    setAceiteModalOpen(true);
  }

  function confirmarAceite() {
    setErro(null);
    const preco = Number(precoInput.replace(',', '.'));
    if (!preco || preco <= 0) {
      setErro('Informe um preço proposto válido (> 0).');
      return;
    }
    startTransition(async () => {
      const res = await registrarAceite(operacaoId, true, preco);
      if (!res.ok) {
        setErro(res.error);
        return;
      }
      setAceiteModalOpen(false);
    });
  }

  function registrarRecusa() {
    setErro(null);
    startTransition(async () => {
      const res = await registrarAceite(operacaoId, false, null);
      if (!res.ok) setErro(res.error);
    });
  }

  if (!podeAvancar && !emAceite) return null;

  return (
    <>
      <Card>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-neutral-900">Ações da operação</div>
            <div className="text-xs text-neutral-500">
              {terminal
                ? etapaAtual === 'finalizada'
                  ? 'Operação finalizada — sem novas transições.'
                  : 'Operação cancelada — sem novas transições.'
                : 'Mover a operação para outra etapa do workflow.'}
            </div>
            {emAceite && (
              <div className="mt-2 text-xs text-neutral-600">
                Preço:{' '}
                {precoAceito === true
                  ? `✓ Aceito pelo credor${precoProposto ? ` — ${fmtBRL(precoProposto)}` : ''}`
                  : precoAceito === false
                    ? '✗ Recusado pelo credor'
                    : 'Aguardando resposta do credor'}
              </div>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            {emAceite && precoAceito !== true && (
              <Button
                onClick={abrirAceite}
                disabled={pending}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Check className="size-4" />
                Registrar aceite
              </Button>
            )}
            {emAceite && precoAceito !== false && (
              <Button variant="outline" onClick={registrarRecusa} disabled={pending}>
                <X className="size-4" />
                Registrar recusa
              </Button>
            )}
            {podeAvancar && (
              <Button onClick={abrir} disabled={terminal}>
                Mudar etapa
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {erro && !modalOpen && !aceiteModalOpen && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {erro}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={(open) => !pending && setModalOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mudar etapa</DialogTitle>
            <DialogDescription>
              Etapa atual: <strong className="text-neutral-900">{labelEtapa(etapaAtual)}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nova-etapa">Nova etapa *</Label>
              <select
                id="nova-etapa"
                value={novaEtapa}
                onChange={(e) => setNovaEtapa(e.target.value as Etapa)}
                disabled={pending}
                className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-neutral-900"
              >
                {opcoes.map((et) => (
                  <option key={et} value={et}>
                    {labelEtapa(et)}
                    {et === 'cancelada' ? ' (cancelar operação)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="observacao">Observação (opcional)</Label>
              <textarea
                id="observacao"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                rows={3}
                disabled={pending}
                placeholder="Ex: cliente aprovou por telefone, aguardar assinatura"
                className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900"
              />
              <span className="text-xs text-neutral-500">
                Fica gravada no histórico junto com a mudança.
              </span>
            </div>

            {erro && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {erro}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={confirmar} disabled={pending || !novaEtapa}>
              {pending ? 'Salvando…' : 'Confirmar mudança'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={aceiteModalOpen} onOpenChange={(open) => !pending && setAceiteModalOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar aceite do credor</DialogTitle>
            <DialogDescription>
              Informe o preço proposto que o credor aceitou. Fica gravado como{' '}
              <code className="rounded bg-neutral-100 px-1 text-xs">preco_proposto</code> na
              operação.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preco">Preço proposto (R$) *</Label>
            <input
              id="preco"
              type="text"
              inputMode="decimal"
              value={precoInput}
              onChange={(e) => setPrecoInput(e.target.value)}
              disabled={pending}
              placeholder="Ex: 30000"
              className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-neutral-900"
              autoFocus
            />
          </div>

          {erro && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {erro}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAceiteModalOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              onClick={confirmarAceite}
              disabled={pending || !precoInput}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {pending ? 'Salvando…' : 'Confirmar aceite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
