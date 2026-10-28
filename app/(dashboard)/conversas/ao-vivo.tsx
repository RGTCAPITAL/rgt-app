'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { assinarAutenticado } from '@/lib/supabase/realtime';

/**
 * Mensagem nova, resposta do robô ou status de entrega aparecem na tela de
 * conversas sem recarregar. A RLS das tabelas vale no Realtime: o broker só
 * recebe evento das conversas dele.
 *
 * Recarrega a página (dados do servidor) em vez de montar a mensagem no
 * navegador: a lista, a ordem, a janela e o aviso de robô parado mudam juntos,
 * e a página já sabe calcular tudo isso. Junta rajadas — o robô respondendo
 * gera três eventos (mensagem, status, conversa) — num recarregamento só.
 */
export function ConversasAoVivo() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let espera: ReturnType<typeof setTimeout> | null = null;
    const recarregar = () => {
      if (espera) clearTimeout(espera);
      espera = setTimeout(() => router.refresh(), 400);
    };

    const parar = assinarAutenticado(
      supabase,
      () =>
        supabase
          .channel('conversas-ao-vivo')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'whatsapp_mensagens' },
            recarregar,
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'whatsapp_conversas' },
            recarregar,
          ),
      'conversas',
    );

    return () => {
      if (espera) clearTimeout(espera);
      parar();
    };
  }, [router]);

  return null;
}
