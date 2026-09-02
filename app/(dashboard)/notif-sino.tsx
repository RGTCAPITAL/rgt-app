'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { marcarLida, marcarTodasLidas } from './notif-actions';

export type Notif = {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string | null;
  link: string | null;
  lida_em: string | null;
  created_at: string;
};

function fmtRel(iso: string): string {
  const d = new Date(iso);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin}min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `há ${h}h`;
  const dd = Math.floor(h / 24);
  if (dd < 7) return `há ${dd}d`;
  return d.toLocaleDateString('pt-BR');
}

export function NotifSino({ notifs }: { notifs: Notif[] }) {
  const [aberto, setAberto] = useState(false);
  const [pending, startTransition] = useTransition();
  const naoLidas = notifs.filter((n) => !n.lida_em).length;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function fechar(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    if (aberto) document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [aberto]);

  function handleMarcarLida(id: string) {
    startTransition(async () => {
      await marcarLida(id);
    });
  }

  function handleMarcarTodas() {
    startTransition(async () => {
      await marcarTodasLidas();
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-label="Notificações"
        className={`relative rounded-md p-2 hover:bg-neutral-100 ${
          naoLidas > 0 ? 'text-neutral-900' : 'text-neutral-400'
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {naoLidas > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 top-12 z-50 w-80 rounded-md border border-neutral-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
            <span className="text-sm font-semibold text-neutral-900">Notificações</span>
            {naoLidas > 0 && (
              <button
                type="button"
                onClick={handleMarcarTodas}
                disabled={pending}
                className="text-xs text-neutral-600 hover:text-neutral-900 disabled:opacity-40"
              >
                Marcar todas como lidas
              </button>
            )}
          </div>

          {notifs.length === 0 ? (
            <p className="p-6 text-center text-sm text-neutral-500">
              Nenhuma notificação por enquanto.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-neutral-100 overflow-y-auto">
              {notifs.map((n) => {
                const naoLida = !n.lida_em;
                const conteudo = (
                  <div className="flex gap-2 px-3 py-2.5 hover:bg-neutral-50">
                    <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${naoLida ? 'bg-blue-600' : 'bg-transparent'}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${naoLida ? 'font-semibold text-neutral-900' : 'text-neutral-700'}`}>
                        {n.titulo}
                      </p>
                      {n.descricao && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-neutral-600">{n.descricao}</p>
                      )}
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-neutral-400">
                        {fmtRel(n.created_at)}
                      </p>
                    </div>
                  </div>
                );

                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link
                        href={n.link}
                        onClick={() => {
                          setAberto(false);
                          if (naoLida) handleMarcarLida(n.id);
                        }}
                      >
                        {conteudo}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => naoLida && handleMarcarLida(n.id)}
                        className="w-full text-left"
                      >
                        {conteudo}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
