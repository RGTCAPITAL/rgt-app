'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { STATUS_LEAD, type StatusLead } from '@/lib/leads';
import { leadFormSchema } from './lead-schemas';
import { titleCase } from '@/lib/formatters';

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const STATUS_VALIDOS = STATUS_LEAD.map((s) => s.value) as readonly StatusLead[];

export async function criarLead(payload: Record<string, unknown>): Promise<Result<{ id: string }>> {
  const parsed = leadFormSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  // Broker só cria pra si mesmo — força dono_id = self
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();
  const isBroker = usuario?.perfil?.slug === 'broker';

  const insert = {
    nome: titleCase(parsed.data.nome),
    telefone: parsed.data.telefone || null,
    email: parsed.data.email || null,
    cpf_cnpj: parsed.data.cpf_cnpj || null,
    origem: parsed.data.origem,
    notas: parsed.data.notas || null,
    dono_id: isBroker ? user.id : parsed.data.dono_id || null,
    status: 'novo' as const,
  };

  const { data, error } = await supabase.from('leads').insert(insert).select('id').single();
  if (error) return { ok: false, error: error.message };

  revalidatePath('/crm');
  return { ok: true, data: { id: data.id } };
}

export async function atualizarLead(
  leadId: string,
  payload: Record<string, unknown>,
): Promise<Result> {
  const parsed = leadFormSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const update = {
    nome: titleCase(parsed.data.nome),
    telefone: parsed.data.telefone || null,
    email: parsed.data.email || null,
    cpf_cnpj: parsed.data.cpf_cnpj || null,
    origem: parsed.data.origem,
    notas: parsed.data.notas || null,
    dono_id: parsed.data.dono_id || null,
  };

  const { data, error } = await supabase
    .from('leads')
    .update(update)
    .eq('id', leadId)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Lead não encontrado ou sem permissão.' };

  revalidatePath('/crm');
  return { ok: true };
}

type ImportRow = {
  nome: string;
  telefone?: string;
  email?: string;
  cpf_cnpj?: string;
  notas?: string;
};

export async function importarLeadsBatch(
  rows: ImportRow[],
  origem: string,
): Promise<Result<{ criados: number; erros: string[] }>> {
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
  const role = usuario?.perfil?.slug;
  if (role !== 'admin' && role !== 'gestao') {
    return { ok: false, error: 'Apenas admin ou gestão pode importar em massa.' };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: 'CSV vazio ou inválido.' };
  }
  if (rows.length > 1000) {
    return { ok: false, error: 'Limite de 1000 linhas por importação.' };
  }

  const somenteDigitos = (s?: string) => (s ?? '').replace(/\D/g, '');
  const inserts: Record<string, unknown>[] = [];
  const erros: string[] = [];

  rows.forEach((row, i) => {
    const linha = i + 2; // +2 = 1 pelo header + 1 pra virar 1-indexed
    const nome = (row.nome || '').trim();
    if (nome.length < 2) {
      erros.push(`Linha ${linha}: nome ausente ou muito curto`);
      return;
    }
    const telefone = somenteDigitos(row.telefone);
    if (telefone && (telefone.length < 10 || telefone.length > 13)) {
      erros.push(`Linha ${linha}: telefone inválido (${telefone.length} dígitos)`);
      return;
    }
    const cpf = somenteDigitos(row.cpf_cnpj);
    if (cpf && cpf.length !== 11 && cpf.length !== 14) {
      erros.push(`Linha ${linha}: CPF/CNPJ deve ter 11 ou 14 dígitos`);
      return;
    }
    const email = (row.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      erros.push(`Linha ${linha}: email inválido`);
      return;
    }
    inserts.push({
      nome: titleCase(nome),
      telefone: telefone || null,
      email: email || null,
      cpf_cnpj: cpf || null,
      origem,
      notas: (row.notas || '').trim() || null,
      status: 'novo',
      dono_id: role === 'admin' ? null : user.id,
    });
  });

  if (inserts.length === 0) {
    return { ok: false, error: 'Nenhuma linha válida. ' + erros.slice(0, 3).join(' · ') };
  }

  const { error, count } = await supabase.from('leads').insert(inserts, { count: 'exact' });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/crm');
  return { ok: true, data: { criados: count ?? inserts.length, erros } };
}

export async function mudarStatusLead(
  leadId: string,
  novoStatus: StatusLead,
  motivoPerda?: string,
): Promise<Result> {
  if (!STATUS_VALIDOS.includes(novoStatus)) {
    return { ok: false, error: 'Status inválido.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  // Se está indo pra 'ganho', bloqueia — ganho só via "Virar operação" (RGT-63)
  if (novoStatus === 'ganho') {
    return {
      ok: false,
      error: 'Pra marcar como "Ganho", use o botão "Virar operação" no card.',
    };
  }

  // Se está indo pra 'perdido', exige motivo (constraint do banco também exige)
  if (novoStatus === 'perdido' && !motivoPerda?.trim()) {
    return { ok: false, error: 'Informe o motivo da perda.' };
  }

  const update: Record<string, unknown> = { status: novoStatus };
  if (novoStatus === 'perdido') update.motivo_perda = motivoPerda!.trim();
  if (novoStatus !== 'perdido') update.motivo_perda = null; // limpa se saiu de perdido

  const { data: updated, error } = await supabase
    .from('leads')
    .update(update)
    .eq('id', leadId)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: 'Lead não encontrado ou sem permissão.' };

  revalidatePath('/crm');
  return { ok: true };
}
