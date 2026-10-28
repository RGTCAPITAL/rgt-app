'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { assinarAutenticado } from '@/lib/supabase/realtime';

/**
 * Aviso novo aparece na hora, sem a pessoa trocar de página.
 *
 * Antes, o sino só atualizava na navegação: um cliente podia ficar esperando
 * o broker enquanto o aviso estava parado na tela. Agora o Realtime do
 * Supabase empurra o INSERT em `notificacoes` (migration 046), e a RLS da
 * tabela garante que cada um só recebe o que é seu — o filtro aqui é
 * economia de tráfego, não segurança.
 *
 * O balão chama atenção dentro da plataforma; o `router.refresh()` atualiza o
 * sino, que vem do layout. Fora da plataforma (celular, e-mail) não chega
 * nada: é decisão de 2026-10-28, não esquecimento.
 */
export function AvisosAoVivo({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    return assinarAutenticado(
      supabase,
      () =>
        supabase.channel(`avisos-${userId}`).on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notificacoes',
            filter: `destinatario=eq.${userId}`,
          },
          (payload) => {
            const n = payload.new as {
              titulo: string;
              descricao: string | null;
              link: string | null;
            };
            toast(n.titulo, {
              description: n.descricao ?? undefined,
              duration: 10_000,
              action: n.link ? { label: 'Abrir', onClick: () => router.push(n.link!) } : undefined,
            });
            router.refresh();
          },
        ),
      'avisos',
    );
  }, [userId, router]);

  return null;
}
