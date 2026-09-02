import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase com service role — bypassa RLS.
 *
 * USAR APENAS em rotas server-side (API routes, server actions) que já validaram
 * autorização por outra via (webhook secret, sessão admin verificada, etc).
 * NUNCA importar de client components.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_URL ausente no ambiente');
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
