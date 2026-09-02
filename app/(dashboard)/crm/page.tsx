import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Kanban, type LeadCard } from './kanban';
import { ORIGEM_LEAD } from '@/lib/leads';

type SearchParams = { origem?: string; dono?: string };

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let query = supabase
    .from('leads')
    .select(
      'id, nome, telefone, email, origem, status, created_at, motivo_perda, operacao_id, dono:usuarios!leads_dono_id_fkey(id, nome)',
    )
    .order('created_at', { ascending: false });

  if (params.origem) query = query.eq('origem', params.origem);
  if (params.dono) query = query.eq('dono_id', params.dono);

  const { data: leads, error } = await query.returns<
    (LeadCard & { dono: { id: string; nome: string | null } | null })[]
  >();

  // Lista de donos únicos pra filtro (a partir do resultado — evita query extra)
  const donosUnicos = Array.from(
    new Map(
      (leads ?? [])
        .filter((l) => l.dono?.id)
        .map((l) => [l.dono!.id, l.dono!.nome ?? '—']),
    ).entries(),
  );

  const temFiltro = Boolean(params.origem || params.dono);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">CRM</h1>
          <p className="mt-2 text-sm text-neutral-600">
            {leads?.length ?? 0} lead{(leads?.length ?? 0) === 1 ? '' : 's'} no pipeline. Arraste
            entre colunas pra mudar status.
          </p>
        </div>
        <button
          type="button"
          disabled
          title="Formulário de novo lead: implementação em RGT-62"
          className="cursor-not-allowed rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white opacity-40"
        >
          + Novo lead
        </button>
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-neutral-200 bg-white p-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-700">Origem</span>
          <select
            name="origem"
            defaultValue={params.origem ?? ''}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 outline-none focus:border-neutral-900"
          >
            <option value="">Todas</option>
            {ORIGEM_LEAD.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-700">Dono</span>
          <select
            name="dono"
            defaultValue={params.dono ?? ''}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 outline-none focus:border-neutral-900"
          >
            <option value="">Todos</option>
            {donosUnicos.map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Filtrar
          </button>
          {temFiltro && (
            <Link
              href="/crm"
              className="rounded-md border border-neutral-300 bg-white px-4 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Limpar
            </Link>
          )}
        </div>
      </form>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Erro: {error.message}
        </div>
      )}

      <Kanban leads={leads ?? []} />
    </div>
  );
}
