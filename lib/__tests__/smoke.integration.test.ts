import { describe, expect, it } from 'vitest';
import {
  clienteComo,
  podeRodarIntegracao,
  motivoSkip,
  idDoUsuario,
} from './helpers/clientes-teste';

describe.skipIf(!podeRodarIntegracao)('conexão com o banco de teste', () => {
  it('autentica como cada perfil', async () => {
    for (const perfil of ['admin', 'gestao', 'juridico', 'broker'] as const) {
      const c = await clienteComo(perfil);
      const {
        data: { user },
      } = await c.auth.getUser();
      expect(user, `sessão vazia para ${perfil}`).toBeTruthy();
      await new Promise((r) => setTimeout(r, 400));
    }
  });

  it('resolve o id de cada usuário de teste', async () => {
    const id = await idDoUsuario('broker');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe.runIf(!podeRodarIntegracao)('integração indisponível', () => {
  it('explica o motivo do skip', () => {
    console.warn(motivoSkip());
    expect(true).toBe(true);
  });
});
