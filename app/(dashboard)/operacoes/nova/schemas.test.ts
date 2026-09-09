import { describe, expect, it } from 'vitest';
import { step1Schema } from './schemas';

/**
 * O banco passou a exigir 20 dígitos no CNJ e a recusar duplicata comparando só
 * os dígitos (migration 025). Estes testes travam a validação equivalente no
 * formulário — sem ela, o usuário receberia o erro cru do Postgres.
 */

const base = {
  cedente_nome: 'João da Silva',
  cedente_cpf: '529.982.247-25',
  numero_processo: '0001234-56.2020.5.19.0001',
  tipo: 'precatorio' as const,
  natureza: 'alimentar' as const,
  esfera: 'estadual' as const,
  tribunal: 'TJAL - Tribunal de Justiça de Alagoas',
  ente_devedor_id: '550e8400-e29b-41d4-a716-446655440000',
  especie: 'credito_total' as const,
  data_base: '2026-01-15',
};

function validarCnj(numero_processo: string) {
  return step1Schema.safeParse({ ...base, numero_processo });
}

/** Mostra qual campo reprovou, em vez de só "expected false to be true". */
function motivos(r: ReturnType<typeof validarCnj>): string {
  return r.success
    ? ''
    : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ');
}

describe('step1Schema · número do processo', () => {
  it('aceita CNJ mascarado, que é o que a máscara do formulário produz', () => {
    const r = validarCnj('0001234-56.2020.5.19.0001');
    expect(motivos(r)).toBe('');
  });

  it('aceita CNJ só com dígitos', () => {
    const r = validarCnj('00012345620205190001');
    expect(motivos(r)).toBe('');
  });

  it('recusa texto de 20 caracteres que não é CNJ', () => {
    // O `min(20)` anterior deixava isto passar até o banco.
    const r = validarCnj('asdfasdfasdfasdfasdf');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.message).toMatch(/20 d[íi]gitos/i);
  });

  it('recusa CPF no lugar do CNJ', () => {
    expect(validarCnj('529.982.247-25').success).toBe(false);
  });

  it('recusa CNJ com dígito faltando', () => {
    expect(validarCnj('0001234-56.2020.5.19.000').success).toBe(false);
  });

  it('recusa CNJ com dígito sobrando', () => {
    expect(validarCnj('0001234-56.2020.5.19.00012').success).toBe(false);
  });

  it('recusa campo vazio', () => {
    expect(validarCnj('').success).toBe(false);
  });

  it('ignora espaços nas pontas', () => {
    expect(validarCnj('  0001234-56.2020.5.19.0001  ').success).toBe(true);
  });
});
