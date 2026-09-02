'use client';

import { useState, useTransition } from 'react';
import { criarTarefa, atualizarStatusTarefa } from './tarefas-actions';
import { fmtDataBR } from '@/lib/formatters';

export type Tarefa = {
  id: string;
  titulo: string;
  descricao: string | null;
  destinatario_perfil: string | null;
  destinatario_id: string | null;
  prazo: string | null;
  status: string;
  created_at: string;
  criado_por: { nome: string | null } | null;
  destinatario: { nome: string | null } | null;
};

export type UsuarioOpt = { id: string; nome: string | null };

const PERFIS_LABEL: Record<string, string> = {
  admin: 'Admin',
  gestao: 'Gestão',
  juridico: 'Jurídico',
  broker: 'Broker',
};

const STATUS_LABEL: Record<string, { label: string; cor: string }> = {
  pendente: { label: 'Pendente', cor: 'bg-neutral-100 text-neutral-700' },
  em_andamento: { label: 'Em andamento', cor: 'bg-blue-100 text-blue-800' },
  concluida: { label: 'Concluída', cor: 'bg-emerald-100 text-emerald-800' },
  cancelada: { label: 'Cancelada', cor: 'bg-red-100 text-red-800' },
};

function estaAtrasada(prazo: string | null, status: string): boolean {
  if (!prazo || status === 'concluida' || status === 'cancelada') return false;
  return prazo < new Date().toISOString().slice(0, 10);
}

type Props = {
  operacaoId: string;
  tarefas: Tarefa[];
  usuarios: UsuarioOpt[];
  meuId: string;
};

export function TabTarefas({ operacaoId, tarefas, usuarios, meuId }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [destPerfil, setDestPerfil] = useState('');
  const [destId, setDestId] = useState('');
  const [prazo, setPrazo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function criar() {
    setErro(null);
    if (!titulo.trim()) {
      setErro('Título obrigatório.');
      return;
    }
    startTransition(async () => {
      const res = await criarTarefa({
        operacaoId,
        titulo,
        descricao: descricao || undefined,
        destinatarioPerfil: destPerfil || undefined,
        destinatarioId: destId || undefined,
        prazo: prazo || undefined,
      });
      if (!res.ok) {
        setErro(res.error);
        return;
      }
      setTitulo('');
      setDescricao('');
      setDestPerfil('');
      setDestId('');
      setPrazo('');
      setModalOpen(false);
    });
  }

  function mudarStatus(id: string, status: string) {
    setErro(null);
    startTransition(async () => {
      const res = await atualizarStatusTarefa(id, status);
      if (!res.ok) setErro(res.error);
    });
  }

  const abertas = tarefas.filter((t) => t.status === 'pendente' || t.status === 'em_andamento');
  const fechadas = tarefas.filter((t) => t.status === 'concluida' || t.status === 'cancelada');

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-neutral-600">
          {abertas.length} tarefa{abertas.length === 1 ? '' : 's'} aberta
          {abertas.length === 1 ? '' : 's'}
          {fechadas.length > 0 &&
            ` · ${fechadas.length} fechada${fechadas.length === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
        >
          + Nova tarefa
        </button>
      </div>

      {erro && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {erro}
        </div>
      )}

      {tarefas.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-500">
          Nenhuma tarefa nesta operação. Crie uma pra atribuir ação estruturada.
        </p>
      ) : (
        <div className="space-y-2">
          {[...abertas, ...fechadas].map((t) => {
            const atrasada = estaAtrasada(t.prazo, t.status);
            const stat = STATUS_LABEL[t.status] ?? STATUS_LABEL.pendente;
            return (
              <div
                key={t.id}
                className={`rounded-md border p-3 text-sm ${
                  atrasada ? 'border-red-300 bg-red-50/50' : 'border-neutral-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${stat.cor}`}
                      >
                        {stat.label}
                      </span>
                      {atrasada && (
                        <span className="rounded-full bg-red-200 px-2 py-0.5 text-[10px] font-medium text-red-800">
                          Atrasada
                        </span>
                      )}
                      <span className="font-medium text-neutral-900">{t.titulo}</span>
                    </div>
                    {t.descricao && (
                      <p className="mt-1 text-xs whitespace-pre-wrap text-neutral-700">
                        {t.descricao}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
                      {t.criado_por?.nome && <span>Por {t.criado_por.nome}</span>}
                      <span>
                        Para:{' '}
                        {t.destinatario?.nome ??
                          (t.destinatario_perfil ? PERFIS_LABEL[t.destinatario_perfil] : '—')}
                      </span>
                      {t.prazo && (
                        <span className={atrasada ? 'font-medium text-red-700' : ''}>
                          Prazo {fmtDataBR(t.prazo)}
                        </span>
                      )}
                    </div>
                  </div>
                  {t.status !== 'concluida' && t.status !== 'cancelada' && (
                    <div className="flex shrink-0 gap-1">
                      {t.status === 'pendente' && (
                        <button
                          type="button"
                          onClick={() => mudarStatus(t.id, 'em_andamento')}
                          disabled={pending}
                          className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
                        >
                          Iniciar
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => mudarStatus(t.id, 'concluida')}
                        disabled={pending}
                        className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                      >
                        ✓ Concluir
                      </button>
                      <button
                        type="button"
                        onClick={() => mudarStatus(t.id, 'cancelada')}
                        disabled={pending}
                        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                  {t.status === 'concluida' && (
                    <button
                      type="button"
                      onClick={() => mudarStatus(t.id, 'pendente')}
                      disabled={pending}
                      className="shrink-0 rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
                    >
                      Reabrir
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
          onClick={() => !pending && setModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-md border border-neutral-200 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-neutral-900">Nova tarefa</h2>

            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-neutral-700">Título *</span>
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                disabled={pending}
                placeholder="Ex: Enviar certidão federal 2º grau"
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
                autoFocus
              />
            </label>

            <label className="mt-3 flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-neutral-700">Descrição (opcional)</span>
              <textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                disabled={pending}
                rows={2}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
            </label>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-medium text-neutral-700">Perfil destino</span>
                <select
                  value={destPerfil}
                  onChange={(e) => {
                    setDestPerfil(e.target.value);
                    if (e.target.value) setDestId('');
                  }}
                  disabled={pending}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
                >
                  <option value="">—</option>
                  {Object.entries(PERFIS_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-medium text-neutral-700">OU Pessoa</span>
                <select
                  value={destId}
                  onChange={(e) => {
                    setDestId(e.target.value);
                    if (e.target.value) setDestPerfil('');
                  }}
                  disabled={pending}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
                >
                  <option value="">—</option>
                  {usuarios
                    .filter((u) => u.id !== meuId)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nome ?? '—'}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <label className="mt-3 flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-neutral-700">Prazo (opcional)</span>
              <input
                type="date"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
                disabled={pending}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
            </label>

            {erro && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                {erro}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={pending}
                className="rounded-md px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={criar}
                disabled={pending || !titulo.trim()}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
              >
                {pending ? 'Criando…' : 'Criar tarefa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
