'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { transicoesPermitidas, type Etapa } from '@/lib/workflow';

type ChangeEtapaResult = { ok: true } | { ok: false; error: string };

export async function mudarEtapa(
  operacaoId: string,
  novaEtapa: Etapa,
  observacao: string,
): Promise<ChangeEtapaResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return { ok: false, error: 'Sessão expirada.' };

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();

  const role = usuario?.perfil?.slug ?? '';
  if (!['admin', 'gestao'].includes(role)) {
    return { ok: false, error: 'Somente admin/gestão podem mudar etapa.' };
  }

  const { data: op, error: opError } = await supabase
    .from('operacoes')
    .select('etapa_atual, preco_aceito')
    .eq('id', operacaoId)
    .single<{ etapa_atual: string; preco_aceito: boolean | null }>();

  if (opError || !op) return { ok: false, error: 'Operação não encontrada.' };

  const permitidas = transicoesPermitidas(op.etapa_atual);
  if (!permitidas.includes(novaEtapa)) {
    return {
      ok: false,
      error: `Transição inválida: de "${op.etapa_atual}" não é possível ir direto pra "${novaEtapa}".`,
    };
  }

  const saindoDeAceite = op.etapa_atual === 'aceite' && novaEtapa === 'due_diligence_juridica';
  if (saindoDeAceite && op.preco_aceito !== true) {
    return {
      ok: false,
      error:
        'Não é possível avançar de "Aceite" sem que o credor tenha aceitado o preço. Registre o aceite primeiro.',
    };
  }

  const obsTrim = observacao.trim();

  const { error: updateError } = await supabase
    .from('operacoes')
    .update({ etapa_atual: novaEtapa })
    .eq('id', operacaoId);

  if (updateError) return { ok: false, error: updateError.message };

  if (obsTrim) {
    const { error: obsError } = await supabase
      .from('etapas_operacao')
      .update({ observacao: obsTrim })
      .eq('operacao_id', operacaoId)
      .is('saiu_em', null);
    if (obsError) {
      // etapa foi trocada; observação é bônus — logamos mas não falhamos
      console.error('Falha ao gravar observação da nova etapa:', obsError.message);
    }
  }

  revalidatePath(`/operacoes/${operacaoId}`);
  revalidatePath('/operacoes');
  return { ok: true };
}

export async function registrarAceite(
  operacaoId: string,
  aceitou: boolean,
  precoProposto: number | null,
): Promise<ChangeEtapaResult> {
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
  if (!['admin', 'gestao', 'broker'].includes(role)) {
    return { ok: false, error: 'Sem permissão pra registrar aceite.' };
  }

  const { data: op } = await supabase
    .from('operacoes')
    .select('etapa_atual, preco_proposto')
    .eq('id', operacaoId)
    .single<{ etapa_atual: string; preco_proposto: number | null }>();

  if (!op || op.etapa_atual !== 'aceite') {
    return { ok: false, error: 'Aceite só pode ser registrado na etapa "Aceite".' };
  }

  // Pra aceitar, é preciso ter preço proposto (constraint operacoes_aceite_precisa_preco).
  // Se ainda não tem, o caller passa o valor via `precoProposto`.
  const precoParaSalvar =
    op.preco_proposto ?? (precoProposto !== null && precoProposto > 0 ? precoProposto : null);

  if (aceitou && precoParaSalvar === null) {
    return {
      ok: false,
      error: 'Pra registrar aceite é preciso informar o preço proposto ao credor.',
    };
  }

  const update: Record<string, unknown> = { preco_aceito: aceitou };
  if (precoParaSalvar !== null) update.preco_proposto = precoParaSalvar;

  const { error } = await supabase.from('operacoes').update(update).eq('id', operacaoId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/operacoes/${operacaoId}`);
  return { ok: true };
}
