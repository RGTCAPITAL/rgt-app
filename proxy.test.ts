import { describe, expect, it } from 'vitest';
import { ehRotaPublica, PUBLIC_ROUTES } from './proxy';

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
