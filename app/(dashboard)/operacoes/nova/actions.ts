'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { step1Schema, step2Schema } from './schemas';

type PayloadNovaOperacao = {
  step1: Record<string, unknown>;
  step2: Record<string, unknown>;
};

export type CriarOperacaoResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

function parseNumero(v: unknown): number {
  return Number(String(v ?? '').replace(',', '.'));
}

export async function criarOperacao(payload: PayloadNovaOperacao): Promise<CriarOperacaoResult> {
  const s1 = step1Schema.safeParse(payload.step1);
  if (!s1.success) return { ok: false, error: 'Dados do ativo inválidos: ' + s1.error.issues[0]?.message };

  const s2 = step2Schema.safeParse(payload.step2);
  if (!s2.success) return { ok: false, error: 'Valores inválidos: ' + s2.error.issues[0]?.message };

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return { ok: false, error: 'Sessão expirada. Faça login novamente.' };

  const { data: usuarioComPerfil, error: perfilError } = await supabase
    .from('usuarios')
    .select('id, perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ id: string; perfil: { slug: string } | null }>();

  if (perfilError || !usuarioComPerfil) {
    return { ok: false, error: 'Perfil de usuário não encontrado.' };
  }

  const isBroker = usuarioComPerfil.perfil?.slug === 'broker';

  const valor_principal = parseNumero(s2.data.valor_principal);
  const valor_juros = parseNumero(s2.data.valor_juros);
  const valor_selic = s2.data.valor_selic ? parseNumero(s2.data.valor_selic) : 0;
  const valor_total = valor_principal + valor_juros + valor_selic;

  const insertRow = {
    numero_processo: s1.data.numero_processo,
    tipo: s1.data.tipo,
    esfera: s1.data.esfera,
    natureza: s1.data.natureza,
    especie: s1.data.especie,
    tribunal: s1.data.tribunal,
    ente_devedor_id: s1.data.ente_devedor_id,
    valor_total,
    valor_principal,
    valor_juros,
    valor_selic: valor_selic > 0 ? valor_selic : null,
    retencao_honorarios_pct: parseNumero(s2.data.retencao_honorarios_pct),
    percentual_aquisicao: parseNumero(s2.data.percentual_aquisicao),
    pss_ativo: s2.data.pss_ativo,
    pss_pct: s2.data.pss_ativo ? parseNumero(s2.data.pss_pct) : null,
    rra_ativo: s2.data.rra_ativo,
    rra_meses: s2.data.rra_ativo ? Number(s2.data.rra_meses) : null,
    data_base: s1.data.data_base,
    data_autuacao: s1.data.data_autuacao || null,
    loa: s1.data.loa ? Number(s1.data.loa) : null,
    cedente_nome: s1.data.cedente_nome,
    cedente_cpf: s1.data.cedente_cpf,
    observacoes: s2.data.observacoes || null,
    dono_id: user.id,
    broker_id: isBroker ? user.id : null,
  };

  const { data: nova, error: insertError } = await supabase
    .from('operacoes')
    .insert(insertRow)
    .select('id')
    .single();

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  revalidatePath('/operacoes');
  redirect(`/operacoes/${nova.id}?nova=1`);
}
