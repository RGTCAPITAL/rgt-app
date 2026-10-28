import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/**
 * Assina um canal do Realtime já com a sessão do usuário.
 *
 * A armadilha: no navegador, a sessão vem do cookie e carrega de forma
 * assíncrona. Um canal assinado direto no `useEffect` entra antes disso, como
 * anônimo — e a RLS das tabelas (destinatario = auth.uid(), dono do lead)
 * filtra tudo. O canal fica SUBSCRIBED, não dá erro nenhum, e nenhum evento
 * chega. Aconteceu no primeiro teste do sino ao vivo (2026-10-28).
 *
 * Por isso: pega a sessão, entrega o token ao Realtime, e só então assina. A
 * renovação do token depois disso o próprio cliente do Supabase repassa.
 *
 * Devolve a função de limpeza do `useEffect`.
 */
export function assinarAutenticado(
  supabase: SupabaseClient,
  montar: () => RealtimeChannel,
  rotulo: string,
): () => void {
  let canal: RealtimeChannel | null = null;
  let encerrado = false;

  void (async () => {
    const { data } = await supabase.auth.getSession();
    if (encerrado) return;
    if (data.session) await supabase.realtime.setAuth(data.session.access_token);
    if (encerrado) return;
    canal = montar().subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error(`[${rotulo}] realtime ${status}`, err ?? '');
      }
    });
  })();

  return () => {
    encerrado = true;
    if (canal) void supabase.removeChannel(canal);
  };
}
