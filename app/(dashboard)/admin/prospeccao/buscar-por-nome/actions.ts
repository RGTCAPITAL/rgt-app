'use server';

import { exigirPerfil } from '@/lib/auth/roles';
import { buscarPorNome, TRIBUNAIS_PADRAO, type ResultadoBusca } from '@/lib/djen/busca-por-nome';
import { createClient } from '@/lib/supabase/server';
import { criarLead } from '@/app/(dashboard)/crm/actions';

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

export type ResultadoCriarLead =
  | { ok: true; id: string }
  | { ok: false; error: string; leadExistente?: { id: string; nome: string } };

/**
 * Cria um lead a partir de um processo achado na busca por nome.
 *
 * Antes a busca só informava: o advogado copiava o número, abria o CRM e
 * redigitava nome, processo e devedor. Aqui o lead nasce com esses dados, e
 * ele só completa o que o diário não traz (telefone).
 *
 * Confere duplicata pelo número do processo — com e sem máscara, porque o
 * importador e o formulário gravam do jeito que a pessoa digitou.
 */
export async function criarLeadDaBusca(
  payload: Record<string, unknown>,
): Promise<ResultadoCriarLead> {
  const auth = await exigirPerfil(['admin', 'gestao', 'broker']);
  if (!auth.ok) return { ok: false, error: auth.error };

  const processo = String(payload.numero_processo ?? '').trim();
  const digitos = processo.replace(/\D/g, '');
  if (digitos.length === 20) {
    const supabase = await createClient();
    const { data: existente } = await supabase
      .from('leads')
      .select('id, nome')
      .in('numero_processo', [processo, digitos])
      .limit(1)
      .maybeSingle<{ id: string; nome: string }>();
    if (existente) {
      return {
        ok: false,
        error: `Já existe um lead para este processo: ${existente.nome}.`,
        leadExistente: existente,
      };
    }
  }

  const r = await criarLead(payload);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, id: r.data?.id ?? '' };
}
