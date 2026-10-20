import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Sem /cadastro: não há auto-registro. Usuário entra por convite de admin
// (/admin/usuarios), que já define o perfil.
const AUTH_ROUTES = ['/login', '/esqueci-senha', '/redefinir-senha', '/verifique-email'];

/**
 * Rotas de auth que mandam o usuário JÁ LOGADO pro dashboard.
 *
 * `/redefinir-senha` está fora desta lista de propósito, e a razão é o oposto
 * do que parece: a sessão de recovery é uma sessão real. Quem chega pelo link
 * do email chega **logado**. Com essa rota aqui, o proxy devolve 307 pro
 * dashboard antes de o formulário aparecer — a pessoa cai no app achando que
 * redefiniu, com a senha antiga intacta e nenhuma mensagem na tela.
 *
 * Isso quebrava o convite de admin (que já passa por /auth/callback) e
 * quebraria o reset de senha no instante seguinte ao fix do redirectTo.
 * Coberto por proxy.test.ts.
 */
export const REDIRECT_SE_LOGADO = ['/login', '/esqueci-senha', '/verifique-email'];

/**
 * O bounce não pode engolir mensagem de erro.
 *
 * Quando /auth/callback falha, ele manda pra `/login?error=...`. Se a pessoa
 * ainda tem uma sessão antiga no browser, o bounce acima a leva pro dashboard e
 * a mensagem morre no caminho: a pessoa clica no link do email de reset e
 * simplesmente aparece no painel, sem nada explicando o que houve. Foi isso que
 * aconteceu em 20/10 e o que fez o bug parecer "email não chega".
 */
export function deveMandarPraDashboard(path: string, temErro: boolean): boolean {
  if (temErro) return false;
  return REDIRECT_SE_LOGADO.includes(path);
}

/**
 * Rotas que passam sem sessão.
 *
 * `/api/cron` está aqui porque o agendador da Vercel chega sem cookie, e o jeito
 * como esta função falha é pior que negar acesso: ela responde **307 pra
 * /login**. O cron da Vercel não segue redirect, e a Vercel não registra log de
 * resposta redirecionada — então uma rota de cron ausente daqui produz um job
 * que aparece configurado, roda todo dia, devolve sucesso e nunca executa nada.
 * Sem rastro em lugar nenhum.
 *
 * Quem autoriza a rota de cron é o próprio handler, comparando o segredo.
 * "Público" aqui significa "a sessão não é a credencial", não "sem credencial".
 *
 * Coberto por proxy.test.ts, que existe porque nem build, nem checagem de tipo,
 * nem teste do handler pegam esse modo de falha.
 */
export const PUBLIC_ROUTES = [
  ...AUTH_ROUTES,
  '/auth/callback',
  '/auth/signout',
  '/api/leads/webhook',
  '/api/cron',
];

/**
 * Casamento por SEGMENTO de caminho, nunca por substring.
 *
 * `/api/cron` tem que liberar `/api/cron/indices` e NÃO liberar
 * `/api/cronometro`. Daí `path === r || path.startsWith(r + '/')` em vez de um
 * `includes`, que abriria a rota errada.
 */
export function ehRotaPublica(path: string): boolean {
  return PUBLIC_ROUTES.some((r) => path === r || path.startsWith(`${r}/`));
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublicRoute = ehRotaPublica(path);

  // Não logado tentando rota privada → login
  if (!user && !isPublicRoute) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Logado tentando página de login/cadastro → dashboard.
  // NÃO use AUTH_ROUTES aqui: ela contém /redefinir-senha, e quem chega do link
  // de recovery chega logado (ver comentário em REDIRECT_SE_LOGADO).
  if (user && deveMandarPraDashboard(path, request.nextUrl.searchParams.has('error'))) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Todas as rotas exceto assets estáticos.
    //
    // ATENÇÃO: isto NÃO exclui /api. Rota de API também passa pelo proxy e
    // precisa estar em PUBLIC_ROUTES pra não tomar redirect. O comentário que
    // estava aqui afirmava o contrário, e era o que fazia parecer que um
    // handler de cron funcionaria sem mexer na lista acima.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
