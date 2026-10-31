import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { destinoDaTarefaDeRegra, repassarTarefasDeRegra } from './repassar';

/** Registra o update e os filtros; nenhum teste toca banco. Ids fictícios. */
function sbFake(erro: { message: string } | null = null) {
  const chamadas: unknown[][] = [];
  const b: Record<string, unknown> = {};
  for (const op of ['update', 'eq', 'is', 'in'])
    b[op] = (...args: unknown[]) => {
      chamadas.push([op, ...args]);
      return b;
    };
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: erro }).then(ok);
  const from = (tabela: string) => {
    chamadas.push(['from', tabela]);
    return b;
  };
  return { sb: { from } as unknown as SupabaseClient, chamadas };
}

afterEach(() => vi.restoreAllMocks());

describe('destinoDaTarefaDeRegra', () => {
  it('com dono: vai pra pessoa e larga o perfil', () => {
    expect(destinoDaTarefaDeRegra('dono-novo')).toEqual({
      destinatario_id: 'dono-novo',
      destinatario_perfil: null,
    });
  });

  it('sem dono: vai pra gestão', () => {
    expect(destinoDaTarefaDeRegra(null)).toEqual({
      destinatario_id: null,
      destinatario_perfil: 'gestao',
    });
  });
});

describe('repassarTarefasDeRegra', () => {
  it('mexe só nas tarefas abertas de regra daquele lead', async () => {
    const { sb, chamadas } = sbFake();
    await repassarTarefasDeRegra(sb, 'lead-1', 'dono-novo');
    expect(chamadas).toEqual([
      ['from', 'tarefas'],
      ['update', { destinatario_id: 'dono-novo', destinatario_perfil: null }],
      ['eq', 'lead_id', 'lead-1'],
      ['is', 'criado_por_id', null],
      ['in', 'status', ['pendente', 'em_andamento']],
    ]);
  });

  it('falha do banco vai pro log e não lança', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sb } = sbFake({ message: 'permission denied' });
    await expect(repassarTarefasDeRegra(sb, 'lead-1', null)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
  });
});
