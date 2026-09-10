import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      // Mesmo alias do tsconfig ("@/*": "./*"). Sem isso o vitest só consegue
      // testar arquivo que usa import relativo — e o código de produção usa @/.
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    // Os testes de RLS precisam das credenciais do Supabase, que vivem no
    // .env.local. O prefixo vazio carrega todas as variáveis, não só as VITE_*.
    env: loadEnv(mode ?? 'test', process.cwd(), ''),
    // Testes de integração falam com o banco: o default de 5s não dá.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
}));
