'use client';

import { useState, useTransition } from 'react';
import { mudarEtapa, registrarAceite } from './actions';
import { labelEtapa, transicoesPermitidas, type Etapa } from '@/lib/workflow';

type Props = {
  operacaoId: string;
  etapaAtual: string;
  podeAvancar: boolean;
  precoAceito: boolean | null;
  precoProposto: number | null;
};

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

  function fechar() {
    if (pending) return;
    setModalOpen(false);
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

  return (
    <>
      {(podeAvancar || emAceite) && (
        <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-white p-4">
          <div>
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
                  ? `✓ Aceito pelo credor${precoProposto ? ` — ${precoProposto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}`
                  : precoAceito === false
                    ? '✗ Recusado pelo credor'
                    : 'Aguardando resposta do credor'}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {emAceite && precoAceito !== true && (
              <button
                type="button"
                onClick={abrirAceite}
                disabled={pending}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                Registrar aceite
              </button>
            )}
            {emAceite && precoAceito !== false && (
              <button
                type="button"
                onClick={registrarRecusa}
                disabled={pending}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
              >
                Registrar recusa
              </button>
            )}
            {podeAvancar && (
              <button
                type="button"
                onClick={abrir}
                disabled={terminal}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Mudar etapa →
              </button>
            )}
          </div>
        </div>
      )}

      {erro && !modalOpen && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {erro}
        </div>
      )}

      {modalOpen && (
        <Modal onClose={fechar}>
          <h2 className="text-lg font-semibold text-neutral-900">Mudar etapa</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Etapa atual: <strong>{labelEtapa(etapaAtual)}</strong>
          </p>

          <label className="mt-4 flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-neutral-700">Nova etapa *</span>
            <select
              value={novaEtapa}
              onChange={(e) => setNovaEtapa(e.target.value as Etapa)}
              disabled={pending}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900"
            >
              {opcoes.map((et) => (
                <option key={et} value={et}>
                  {labelEtapa(et)}
                  {et === 'cancelada' ? ' (cancelar operação)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-neutral-700">Observação (opcional)</span>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={3}
              disabled={pending}
              placeholder="Ex: cliente aprovou por telefone, aguardar assinatura"
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900"
            />
            <span className="text-xs text-neutral-500">
              Fica gravada no histórico junto com a mudança.
            </span>
          </label>

          {erro && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {erro}
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={fechar}
              disabled={pending}
              className="rounded-md px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={pending || !novaEtapa}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
            >
              {pending ? 'Salvando…' : 'Confirmar mudança'}
            </button>
          </div>
        </Modal>
      )}

      {aceiteModalOpen && (
        <Modal onClose={() => !pending && setAceiteModalOpen(false)}>
          <h2 className="text-lg font-semibold text-neutral-900">Registrar aceite do credor</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Informe o preço proposto que o credor aceitou. Esse valor fica gravado como
            <code className="mx-1 rounded bg-neutral-100 px-1 text-xs">preco_proposto</code>
            na operação.
          </p>

          <label className="mt-4 flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-neutral-700">Preço proposto (R$) *</span>
            <input
              type="text"
              inputMode="decimal"
              value={precoInput}
              onChange={(e) => setPrecoInput(e.target.value)}
              disabled={pending}
              placeholder="Ex: 30000"
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900"
              autoFocus
            />
          </label>

          {erro && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {erro}
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAceiteModalOpen(false)}
              disabled={pending}
              className="rounded-md px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmarAceite}
              disabled={pending || !precoInput}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {pending ? 'Salvando…' : 'Confirmar aceite'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-md border border-neutral-200 bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
