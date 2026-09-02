'use client';

import { useState, useTransition } from 'react';
import { atualizarPerfil, toggleAtivo } from './actions';

export type UsuarioRow = {
  id: string;
  email: string;
  nome: string | null;
  ativo: boolean;
  created_at: string;
  perfil_slug: string | null;
};

const PERFIS = [
  { value: 'broker', label: 'Broker' },
  { value: 'juridico', label: 'Jurídico' },
  { value: 'gestao', label: 'Gestão' },
  { value: 'admin', label: 'Admin' },
] as const;

function fmtData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function corPerfil(slug: string | null): string {
  if (slug === 'admin') return 'bg-red-100 text-red-800';
  if (slug === 'gestao') return 'bg-blue-100 text-blue-800';
  if (slug === 'juridico') return 'bg-purple-100 text-purple-800';
  if (slug === 'broker') return 'bg-neutral-100 text-neutral-800';
  return 'bg-amber-100 text-amber-800'; // NULL = sem perfil
}

export function UsuariosLista({ usuarios, meuId }: { usuarios: UsuarioRow[]; meuId: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [_, startTransition] = useTransition();

  function mudarPerfil(userId: string, novoPerfil: string) {
    setErro(null);
    setPendingId(userId);
    startTransition(async () => {
      const res = await atualizarPerfil(userId, novoPerfil);
      if (!res.ok) setErro(res.error);
      setPendingId(null);
    });
  }

  function mudarAtivo(userId: string, novoAtivo: boolean) {
    setErro(null);
    setPendingId(userId);
    startTransition(async () => {
      const res = await toggleAtivo(userId, novoAtivo);
      if (!res.ok) setErro(res.error);
      setPendingId(null);
    });
  }

  return (
    <div>
      {erro && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {erro}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-neutral-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs tracking-wide text-neutral-500 uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Perfil</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Criado</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {usuarios.map((u) => {
                const eu = u.id === meuId;
                const carregando = pendingId === u.id;
                return (
                  <tr key={u.id} className={carregando ? 'opacity-50' : ''}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-neutral-900">{u.nome ?? '—'}</span>
                      {eu && (
                        <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                          você
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{u.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${corPerfil(u.perfil_slug)}`}
                      >
                        {PERFIS.find((p) => p.value === u.perfil_slug)?.label ?? 'sem perfil'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.ativo ? (
                        <span className="text-xs text-emerald-700">● Ativo</span>
                      ) : (
                        <span className="text-xs text-neutral-500">○ Desativado</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{fmtData(u.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <select
                          value={u.perfil_slug ?? ''}
                          onChange={(e) => mudarPerfil(u.id, e.target.value)}
                          disabled={carregando}
                          className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 outline-none focus:border-neutral-900"
                        >
                          {PERFIS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const acao = u.ativo ? 'desativar' : 'ativar';
                            if (confirm(`Confirma ${acao} ${u.nome ?? u.email}?`)) {
                              mudarAtivo(u.id, !u.ativo);
                            }
                          }}
                          disabled={carregando}
                          className={`rounded-md border px-3 py-1 text-xs font-medium ${
                            u.ativo
                              ? 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                              : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          } disabled:opacity-40`}
                        >
                          {u.ativo ? 'Desativar' : 'Ativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs text-neutral-500">
        Mudanças aplicam imediatamente. O único admin ativo não pode se rebaixar nem se desativar
        (proteção contra lock-out).
      </p>
    </div>
  );
}
