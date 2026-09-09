/**
 * Clientes Supabase autenticados como cada perfil, para os testes de RLS.
 *
 * Estes testes rodam contra o banco REAL (não há Docker nesta máquina, então
 * `supabase start` não é opção). Duas salvaguardas:
 *
 *  1. A maioria dos casos verifica que uma ação é BLOQUEADA. Se a barreira
 *     funciona, nada é criado — resíduo zero por construção.
 *  2. Os poucos casos que precisam criar dados usam o prefixo MARCA_TESTE e são
 *     limpos com service role no final, mesmo se o teste falhar.
 *
 * Nunca escreva um teste aqui que altere linha existente. Só crie e apague o
 * que você mesmo criou.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Tudo que os testes criarem carrega esta marca, pra limpeza e auditoria. */
export const MARCA_TESTE = '__rls_test__';

export const PERFIS_TESTE = {
  admin: 'admin.teste@rgtcapital.local',
  gestao: 'beatriz.teste@rgtcapital.local',
  juridico: 'robson.teste@rgtcapital.local',
  broker: 'paulosergio.teste@rgtcapital.local',
} as const;

export type PerfilTeste = keyof typeof PERFIS_TESTE;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const senha = process.env.TEST_USER_PASSWORD;

/**
 * Se faltar credencial, os testes de integração se pulam em vez de falhar —
 * quem clonou o repo sem `.env.local` ainda consegue rodar `npm test`.
 */
export const podeRodarIntegracao = Boolean(url && anonKey && serviceKey && senha);

export function motivoSkip(): string {
  const faltando = [
    !url && 'NEXT_PUBLIC_SUPABASE_URL',
    !anonKey && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
    !senha && 'TEST_USER_PASSWORD',
  ].filter(Boolean);
  return `Testes de RLS pulados — faltam variáveis: ${faltando.join(', ')}`;
}

/**
 * Uma sessão por perfil, reaproveitada por toda a suíte.
 *
 * O GoTrue limita logins por janela de tempo: autenticar a cada teste derrubava
 * a suíte com "Database error querying schema" já no segundo perfil. Também é
 * mais fiel ao real — uma pessoa loga uma vez e navega.
 */
const sessoes = new Map<PerfilTeste, Promise<SupabaseClient>>();

/** Cliente com a sessão de um dos usuários de teste. A RLS vale normalmente. */
export function clienteComo(perfil: PerfilTeste): Promise<SupabaseClient> {
  const existente = sessoes.get(perfil);
  if (existente) return existente;

  const nova = (async () => {
    const client = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({
      email: PERFIS_TESTE[perfil],
      password: senha!,
    });
    if (error) {
      sessoes.delete(perfil); // não cacheia falha: a próxima tentativa retenta
      throw new Error(
        `Não consegui autenticar como ${perfil} (${PERFIS_TESTE[perfil]}): ${error.message}`,
      );
    }
    return client;
  })();

  sessoes.set(perfil, nova);
  return nova;
}

/** Autentica todos os perfis em série, com respiro entre eles. */
export async function autenticarTodos(): Promise<void> {
  for (const perfil of Object.keys(PERFIS_TESTE) as PerfilTeste[]) {
    await clienteComo(perfil);
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** Bypassa RLS. Use só para preparar cenário e limpar depois. */
export function clienteServico(): SupabaseClient {
  return createClient(url!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Id do usuário de teste, sem depender de UUID hardcoded. */
export async function idDoUsuario(perfil: PerfilTeste): Promise<string> {
  const { data, error } = await clienteServico()
    .from('usuarios')
    .select('id')
    .eq('email', PERFIS_TESTE[perfil])
    .single<{ id: string }>();
  if (error || !data) {
    throw new Error(`Usuário de teste ${perfil} não existe no banco: ${error?.message}`);
  }
  return data.id;
}
