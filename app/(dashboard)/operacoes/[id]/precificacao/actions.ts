'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { hojeEmSaoPaulo } from '@/lib/datas';
import {
  COLUNAS_FATOR_LOA,
  fatorDaLinha,
  fatorVigente,
  type LinhaFatorLoa,
} from '@/lib/precificacao/desagio';

type Result = { ok: true } | { ok: false; error: string };

/**
 * Salva o preço proposto ao cedente.
 *
 * Existe porque `registrarAceite` fazia as duas coisas de uma vez: gravava o
 * preço e declarava a resposta do credor no mesmo update, e só funcionava na
 * etapa de aceite. Na vida real o advogado precifica, manda a proposta e
 * espera dias — e o sistema o obrigava a afirmar um aceite que não houve, ou
 * a não guardar o número.
 *
 * Aqui só o preço é gravado. A resposta do credor continua sendo assunto de
 * `registrarAceite`, na etapa certa.
 */

/** Etapas em que faz sentido definir ou revisar preço. */
const ETAPAS_COM_PRECO = ['precificacao', 'aceite'];

/** Teto de sanidade: acima disso é quase certo erro de digitação. */
const TETO_PRECO = 500_000_000;

export async function salvarPrecoProposto(
  operacaoId: string,
  preco: number | null,
  justificativa: string | null,
  /**
   * O fator da LOA que gerou o preço, quando ele veio do "usar o sugerido".
   * Null em preço digitado à mão. É o que permite dizer depois, sem adivinhar,
   * que a proposta ficou desatualizada (RGT-97).
   */
  fatorLoaId: string | null = null,
): Promise<Result> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();

  const role = usuario?.perfil?.slug ?? '';
  if (!['admin', 'gestao'].includes(role)) {
    return { ok: false, error: 'Apenas admin ou gestão pode definir preço.' };
  }

  if (preco !== null) {
    if (!Number.isFinite(preco) || preco <= 0) {
      return { ok: false, error: 'O preço precisa ser um valor positivo.' };
    }
    if (preco > TETO_PRECO) {
      return { ok: false, error: 'Valor acima do teto. Confira se não sobrou um zero.' };
    }
  }

  const { data: op } = await supabase
    .from('operacoes')
    .select('etapa_atual, preco_aceito, loa')
    .eq('id', operacaoId)
    .single<{ etapa_atual: string; preco_aceito: boolean | null; loa: number | null }>();

  if (!op) return { ok: false, error: 'Operação não encontrada.' };

  if (!ETAPAS_COM_PRECO.includes(op.etapa_atual)) {
    return {
      ok: false,
      error: `Preço só pode ser definido nas etapas de precificação e aceite. Esta operação está em ${op.etapa_atual.replace(/_/g, ' ')}.`,
    };
  }

  // Preço já aceito é acordo fechado com o credor. Mudar por baixo
  // transformaria o aceite dele numa coisa que ele não aceitou.
  if (op.preco_aceito === true) {
    return {
      ok: false,
      error: 'O credor já aceitou este preço. Para alterar, registre uma nova negociação.',
    };
  }

  // Limpar o preço só faz sentido enquanto ninguém respondeu nada.
  if (preco === null && op.preco_aceito !== null) {
    return {
      ok: false,
      error: 'Não dá pra apagar o preço depois que o credor respondeu.',
    };
  }

  // O fator só é aceito se for o que vale hoje pra LOA desta operação. Se o
  // Renato mudou o percentual enquanto a tela estava aberta, gravar o antigo
  // pregaria na proposta um número que já não é o dele.
  if (fatorLoaId !== null && preco !== null) {
    if (op.loa === null) {
      return { ok: false, error: 'A operação não tem LOA, então não há percentual a aplicar.' };
    }
    const { data: linhas } = await supabase
      .from('fatores_loa')
      .select(COLUNAS_FATOR_LOA)
      .eq('loa_ano', op.loa)
      .returns<LinhaFatorLoa[]>();
    const vigente = fatorVigente((linhas ?? []).map(fatorDaLinha), op.loa, hojeEmSaoPaulo());
    if (vigente?.id !== fatorLoaId) {
      return {
        ok: false,
        error: 'O percentual desta LOA mudou desde que a tela foi aberta. Recarregue a página.',
      };
    }
  }

  const { error } = await supabase
    .from('operacoes')
    .update({
      preco_proposto: preco,
      preco_proposto_em: preco === null ? null : new Date().toISOString(),
      preco_proposto_por: preco === null ? null : user.id,
      preco_justificativa: justificativa?.trim() || null,
      fator_loa_id: preco === null ? null : fatorLoaId,
    })
    .eq('id', operacaoId);

  if (error) {
    console.error('[precificacao] falha ao salvar preço', error);
    return { ok: false, error: 'Não consegui salvar o preço. Tente de novo.' };
  }

  revalidatePath(`/operacoes/${operacaoId}`);
  revalidatePath(`/operacoes/${operacaoId}/precificacao`);
  return { ok: true };
}
