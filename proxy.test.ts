import { describe, expect, it } from 'vitest';
import { deveMandarPraDashboard, ehRotaPublica, PUBLIC_ROUTES, REDIRECT_SE_LOGADO } from './proxy';

/**
 * O proxy é a única coisa entre a internet e o app, e a forma como ele falha
 * é pior do que negar acesso: ele RESPONDE 307 pra /login.
 *
 * Isso importa porque o cron da Vercel **não segue redirect** e a Vercel **não
 * registra log de resposta redirecionada**. Uma rota de cron que não esteja em
 * PUBLIC_ROUTES produz um job que aparece configurado, roda todo dia, devolve
 * sucesso e nunca executa nada — sem deixar rastro em lugar nenhum.
 *
 * Nenhum teste de build, de tipo ou de unidade do handler pega isso. Este pega.
 */

describe('ehRotaPublica', () => {
  it('libera a rota de cron — senão o job roda em silencio e nao faz nada', () => {
    // O cron da Vercel chega sem cookie de sessão. Se o proxy redirecionar,
    // a sincronização nunca acontece e a precificação trava quando a série
    // envelhecer — semanas depois, sem ninguém ligar as duas coisas.
    expect(ehRotaPublica('/api/cron/indices')).toBe(true);
  });

  it('libera qualquer rota sob /api/cron, nao só a de indices', () => {
    // O prefixo vale pro que vier depois: a próxima rota agendada nasce
    // funcionando em vez de nascer com o mesmo bug silencioso.
    expect(ehRotaPublica('/api/cron/indices-completo')).toBe(true);
    expect(ehRotaPublica('/api/cron')).toBe(true);
  });

  it('mantém o webhook de leads público', () => {
    // Já estava, e o site em produção depende dele.
    expect(ehRotaPublica('/api/leads/webhook')).toBe(true);
  });

  it('deixa o webhook do WhatsApp público: quem autentica é a assinatura da Meta', () => {
    // Sem isso a Meta toma redirect pro /login e nenhuma mensagem chega,
    // sem erro nenhum aparecendo do nosso lado.
    expect(ehRotaPublica('/api/whatsapp/webhook')).toBe(true);
    expect(ehRotaPublica('/api/whatsapp')).toBe(false);
  });

  it('mantém as telas do app privadas', () => {
    // O risco oposto: abrir demais. Se um dia alguém trocar o `startsWith`
    // por um `includes`, estes casos quebram.
    expect(ehRotaPublica('/')).toBe(false);
    expect(ehRotaPublica('/operacoes')).toBe(false);
    expect(ehRotaPublica('/operacoes/abc-123/precificacao')).toBe(false);
    expect(ehRotaPublica('/admin/indices')).toBe(false);
    expect(ehRotaPublica('/crm')).toBe(false);
  });

  it('nao libera rota que apenas começa com o mesmo texto', () => {
    // '/api/cronometro' compõe o prefixo '/api/cron' como substring, mas não
    // é uma rota de cron. O casamento tem que ser por segmento de caminho.
    expect(ehRotaPublica('/api/cronometro')).toBe(false);
    expect(ehRotaPublica('/loginhack')).toBe(false);
  });

  it('libera as rotas de autenticação', () => {
    expect(ehRotaPublica('/login')).toBe(true);
    expect(ehRotaPublica('/esqueci-senha')).toBe(true);
    expect(ehRotaPublica('/auth/callback')).toBe(true);
  });
});

/**
 * O outro modo de falha silenciosa do proxy, e o mais caro: ele responde 307
 * pro dashboard na rota onde a pessoa deveria digitar a senha nova.
 *
 * A sessão de recovery é uma sessão REAL — quem chega pelo link do email chega
 * logado. Então a regra "logado em rota de auth → manda pro dashboard" cospe a
 * pessoa fora de /redefinir-senha antes do formulário aparecer. Ela cai no app
 * achando que redefiniu, com a senha antiga valendo e nenhuma mensagem.
 *
 * Nem build, nem type-check, nem teste de handler pega isso: é um booleano de
 * uma linha. Este pega.
 */
describe('REDIRECT_SE_LOGADO', () => {
  it('NAO contém /redefinir-senha — senão o form de senha nova fica inalcançável', () => {
    expect(REDIRECT_SE_LOGADO).not.toContain('/redefinir-senha');
  });

  it('ainda manda o logado embora das telas de entrada', () => {
    // O risco oposto: quem já tem sessão não tem o que fazer no /login.
    expect(REDIRECT_SE_LOGADO).toContain('/login');
    expect(REDIRECT_SE_LOGADO).toContain('/esqueci-senha');
    expect(REDIRECT_SE_LOGADO).toContain('/verifique-email');
  });

  it('/redefinir-senha segue pública — sem sessão ainda tem que abrir pra mostrar o erro', () => {
    // Público não é o mesmo que sem sessão: a página checa getUser() e mostra
    // "link inválido ou expirado" em vez do formulário.
    expect(ehRotaPublica('/redefinir-senha')).toBe(true);
  });
});

/**
 * O bounce engolia a mensagem de erro, e esse foi o sintoma relatado em 20/10:
 * "clico no reset e já me joga pro painel sem aparecer a tela de redefinir".
 *
 * Quem clica num link de recovery inválido tendo sessão antiga no browser era
 * mandado de `/login?error=...` direto pro dashboard — sem ver o erro, sem a
 * senha ter mudado, sem pista nenhuma do que aconteceu.
 */
describe('deveMandarPraDashboard', () => {
  it('nao engole a mensagem de erro do callback', () => {
    expect(deveMandarPraDashboard('/login', true)).toBe(false);
    expect(deveMandarPraDashboard('/esqueci-senha', true)).toBe(false);
  });

  it('sem erro, segue mandando o logado pro dashboard', () => {
    expect(deveMandarPraDashboard('/login', false)).toBe(true);
    expect(deveMandarPraDashboard('/esqueci-senha', false)).toBe(true);
  });

  it('nunca manda embora de /redefinir-senha, com ou sem erro', () => {
    expect(deveMandarPraDashboard('/redefinir-senha', false)).toBe(false);
    expect(deveMandarPraDashboard('/redefinir-senha', true)).toBe(false);
  });

  it('nao interfere em rota do app', () => {
    expect(deveMandarPraDashboard('/crm', false)).toBe(false);
    expect(deveMandarPraDashboard('/operacoes', true)).toBe(false);
  });
});

describe('PUBLIC_ROUTES', () => {
  it('toda entrada começa com / e nao termina com /', () => {
    // O casamento é `path === r || path.startsWith(r + '/')`. Uma entrada com
    // barra no fim nunca casaria com nada.
    for (const r of PUBLIC_ROUTES) {
      expect(r.startsWith('/')).toBe(true);
      expect(r.endsWith('/')).toBe(false);
    }
  });
});
