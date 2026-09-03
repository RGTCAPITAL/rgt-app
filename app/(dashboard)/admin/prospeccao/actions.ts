'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/** Payload de UMA linha da planilha TRT19 já parseada no cliente. */
export type LinhaProspeccao = {
  numero_processo: string;
  numero_precatorio: string | null;
  numero_rp: string | null;
  tribunal: string;
  esfera: string | null;
  ente_devedor_nome: string | null;
  natureza_credito: string | null;
  tipo_requisicao: string | null;
  valor_face: number | null;
  autuacao_data: string | null; // ISO YYYY-MM-DD
  vencimento_ano: number | null;
  vara_origem: string | null;
};

const MAX_LINHAS = 5000;

function normalizarCnj(s: string | null | undefined): string | null {
  if (!s) return null;
  const digits = String(s).replace(/\D/g, '');
  if (digits.length !== 20) return null;
  return digits;
}

/**
 * Importa um lote de precatórios prospectáveis.
 *
 * Idempotente via UNIQUE (numero_processo, fonte_lote):
 * re-importar a mesma planilha com o mesmo fonte_lote não duplica.
 * PostgREST não expõe ON CONFLICT diretamente, então usamos upsert.
 */
export async function importarLoteProspeccao(
  rows: LinhaProspeccao[],
  fonteLote: string,
): Promise<
  | { ok: true; data: { criados: number; ignorados: number; erros: string[] } }
  | { ok: false; error: string }
> {
  if (!fonteLote || !/^[a-z0-9_-]{3,60}$/.test(fonteLote)) {
    return { ok: false, error: 'fonte_lote inválido (use minúsculas, dígitos, - _; 3-60 chars)' };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: 'Nenhuma linha detectada.' };
  }
  if (rows.length > MAX_LINHAS) {
    return { ok: false, error: `Máximo ${MAX_LINHAS} linhas por import.` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const erros: string[] = [];
  const validos = rows
    .map((r, i) => {
      const cnj = normalizarCnj(r.numero_processo);
      if (!cnj) {
        erros.push(`L${i + 1}: CNJ inválido`);
        return null;
      }
      if (!r.tribunal) {
        erros.push(`L${i + 1}: tribunal ausente`);
        return null;
      }
      return {
        numero_processo: cnj,
        numero_precatorio: r.numero_precatorio,
        numero_rp: r.numero_rp,
        tribunal: r.tribunal,
        esfera: r.esfera,
        ente_devedor_nome: r.ente_devedor_nome,
        natureza_credito: r.natureza_credito,
        tipo_requisicao: r.tipo_requisicao,
        valor_face: r.valor_face,
        autuacao_data: r.autuacao_data,
        vencimento_ano: r.vencimento_ano,
        vara_origem: r.vara_origem,
        fonte_lote: fonteLote,
        criado_por: user.id,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (validos.length === 0) {
    return { ok: false, error: `Nenhuma linha válida. ${erros.slice(0, 3).join(' · ')}` };
  }

  // Upsert por (numero_processo, fonte_lote) — se já existir, mantém o que tá
  const { data, error } = await supabase
    .from('prospeccao_precatorios')
    .upsert(validos, {
      onConflict: 'numero_processo,fonte_lote',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/prospeccao');
  return {
    ok: true,
    data: {
      criados: data?.length ?? 0,
      ignorados: validos.length - (data?.length ?? 0),
      erros,
    },
  };
}

/**
 * Descarta uma prospecção com motivo (não vai virar lead).
 * Broker usa quando: credor morreu, processo já foi vendido, sem interesse, etc.
 */
export async function descartarProspeccao(
  id: string,
  motivo: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!motivo || motivo.trim().length < 3) {
    return { ok: false, error: 'Motivo é obrigatório (mín 3 chars).' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('prospeccao_precatorios')
    .update({
      status: 'descartado',
      descartado_motivo: motivo.trim(),
      descartado_em: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/prospeccao');
  return { ok: true };
}

/**
 * Vira uma prospecção em lead formal. Broker acabou de descobrir contato.
 *
 * Cria row em `leads` com nome vindo do Judit (ou digitado manual se Judit não rodou)
 * + telefone/email/notas. Marca prospeccao.status='lead_criado' + FK.
 */
export async function virarLead(
  prospeccaoId: string,
  input: { nome: string; telefone: string | null; email: string | null; notas: string | null },
): Promise<{ ok: true; leadId: string } | { ok: false; error: string }> {
  if (!input.nome || input.nome.trim().length < 2) {
    return { ok: false, error: 'Nome do credor obrigatório.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  // Busca a prospecção pra pegar CPF conhecido + validar RLS
  const { data: prosp } = await supabase
    .from('prospeccao_precatorios')
    .select('id, cedente_cpf_provavel, numero_processo, tribunal, valor_face')
    .eq('id', prospeccaoId)
    .maybeSingle();
  if (!prosp) return { ok: false, error: 'Prospecção não encontrada ou sem permissão.' };

  const notasAuto = [
    input.notas?.trim(),
    `Origem: prospecção ${prosp.tribunal} · Proc ${prosp.numero_processo}`,
    prosp.valor_face ? `Valor face: R$ ${Number(prosp.valor_face).toLocaleString('pt-BR')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .insert({
      nome: input.nome.trim(),
      telefone: input.telefone?.trim() || null,
      email: input.email?.trim() || null,
      cpf_cnpj: prosp.cedente_cpf_provavel,
      origem: 'outro',
      status: 'em_contato',
      dono_id: user.id,
      notas: notasAuto,
    })
    .select('id')
    .single();

  if (leadErr) return { ok: false, error: leadErr.message };

  const { error: updErr } = await supabase
    .from('prospeccao_precatorios')
    .update({ status: 'lead_criado', lead_id: lead.id, responsavel_id: user.id })
    .eq('id', prospeccaoId);

  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath('/admin/prospeccao');
  revalidatePath('/crm');
  return { ok: true, leadId: lead.id };
}
