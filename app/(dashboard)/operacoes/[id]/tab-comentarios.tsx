'use client';

import { useState, useTransition } from 'react';
import { criarComentario, deletarComentario } from './comentarios-actions';
import { labelEtapa } from '@/lib/workflow';

export type Comentario = {
  id: string;
  texto: string;
  etapa: string | null;
  created_at: string;
  autor: { id: string; nome: string | null } | null;
};

type Props = {
  operacaoId: string;
  usuarioAtualId: string;
  isAdmin: boolean;
  comentarios: Comentario[];
};

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const diffMs = hoje.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  if (diffH < 24) return `há ${diffH}h`;
  if (diffD < 7) return `há ${diffD}d`;
  return d.toLocaleDateString('pt-BR');
}

function iniciais(nome: string | null): string {
  if (!nome) return '?';
  return nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function TabComentarios({ operacaoId, usuarioAtualId, isAdmin, comentarios }: Props) {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function enviar() {
    setErro(null);
    if (!texto.trim()) return;
    startTransition(async () => {
      const res = await criarComentario(operacaoId, texto);
      if (!res.ok) {
        setErro(res.error);
        return;
      }
      setTexto('');
    });
  }

  function apagar(id: string) {
    if (!confirm('Apagar este comentário?')) return;
    setErro(null);
    startTransition(async () => {
      const res = await deletarComentario(operacaoId, id);
      if (!res.ok) setErro(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
          disabled={pending}
          placeholder="Escreva um comentário… (fica vinculado à etapa atual da operação)"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') enviar();
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-neutral-500">
            {texto.length}/5000 · <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 text-[10px]">Ctrl+Enter</kbd> pra enviar
          </span>
          <button
            type="button"
            onClick={enviar}
            disabled={pending || !texto.trim()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            {pending ? 'Enviando…' : 'Comentar'}
          </button>
        </div>
        {erro && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            {erro}
          </div>
        )}
      </div>

      <hr className="border-neutral-200" />

      {comentarios.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-500">
          Nenhum comentário ainda. Seja o primeiro.
        </p>
      ) : (
        <ul className="space-y-4">
          {comentarios.map((c) => {
            const podeApagar = isAdmin || c.autor?.id === usuarioAtualId;
            return (
              <li key={c.id} className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-medium text-white">
                  {iniciais(c.autor?.nome ?? null)}
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-neutral-900">
                      {c.autor?.nome ?? 'Usuário removido'}
                    </span>
                    <span className="text-xs text-neutral-500">{fmtDataHora(c.created_at)}</span>
                    {c.etapa && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                        em {labelEtapa(c.etapa)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-800">{c.texto}</p>
                  {podeApagar && (
                    <button
                      type="button"
                      onClick={() => apagar(c.id)}
                      disabled={pending}
                      className="mt-1 text-xs text-neutral-500 hover:text-red-600 disabled:opacity-40"
                    >
                      Apagar
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
