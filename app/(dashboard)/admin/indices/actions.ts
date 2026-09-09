'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { exigirPerfil } from '@/lib/auth/roles';
import { sincronizarTodas, type ResultadoSync } from '@/lib/indices/sync';

/**
 * Puxa as séries oficiais do BCB/IBGE e grava o que ainda não temos.
 *
 * Usa service role porque a escrita é do sistema, não de uma pessoa — e porque
 * este mesmo caminho vai ser chamado por um cron mensal, sem sessão. O gate de
 * perfil acontece antes, na chamada vinda da UI.
 */
export async function sincronizarIndices(): Promise<
  { ok: true; resultados: ResultadoSync[] } | { ok: false; error: string }
> {
  const auth = await exigirPerfil(['admin', 'gestao']);
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const service = createServiceClient();
    const resultados = await sincronizarTodas(service);
    revalidatePath('/admin/indices');
    return { ok: true, resultados };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
