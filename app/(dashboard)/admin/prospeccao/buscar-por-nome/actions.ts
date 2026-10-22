'use server';

import { exigirPerfil } from '@/lib/auth/roles';
import { buscarPorNome, TRIBUNAIS_PADRAO, type ResultadoBusca } from '@/lib/djen/busca-por-nome';

export type ResultadoAction = { ok: true; data: ResultadoBusca } | { ok: false; error: string };

/**
 * Busca um nome no DJEN e devolve processos triados pela esfera do devedor.
 *
 * O gate é o mesmo da fila de prospecção (`admin`, `gestao`, `broker`): é a
 * mesma atividade, e o broker é justamente quem recebe nome por WhatsApp e
 * precisa saber na hora se vira operação. Não gasta dinheiro — o DJEN é
 * público e gratuito, diferente da Judit.
 */
export async function buscarNomeNoDjen(formData: FormData): Promise<ResultadoAction> {
  const auth = await exigirPerfil(['admin', 'gestao', 'broker']);
  if (!auth.ok) return { ok: false, error: auth.error };

  const nome = String(formData.get('nome') ?? '').trim();
  if (!nome) return { ok: false, error: 'Digite um nome.' };

  const escolhidos = formData.getAll('tribunais').map(String).filter(Boolean);
  const tribunais = escolhidos.length > 0 ? escolhidos : [...TRIBUNAIS_PADRAO];

  try {
    const data = await buscarPorNome(nome, { tribunais });
    return { ok: true, data };
  } catch (erro) {
    // buscarPorNome já engole falha por tribunal e devolve aviso; se estourou
    // aqui é bug nosso, e o broker precisa ver em vez de achar que não há nada.
    console.error('[buscar-por-nome]', nome, erro);
    return { ok: false, error: erro instanceof Error ? erro.message : 'Falha na busca.' };
  }
}
