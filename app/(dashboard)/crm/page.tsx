import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { type LeadCard } from './kanban';
import { CrmShell } from './crm-shell';
import { ORIGEM_LEAD } from '@/lib/leads';
import { buttonVariants } from '@/components/ui/button';
import { SectionHero } from '@/components/ui/section-hero';
import { cn } from '@/lib/utils';

type SearchParams = { origem?: string; dono?: string };

export default async function CrmPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: meuPerfil } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();
  const isAdmin = meuPerfil?.perfil?.slug === 'admin';

  let query = supabase
    .from('leads')
    .select(
      'id, nome, telefone, email, cpf_cnpj, origem, status, created_at, motivo_perda, operacao_id, dono_id, dono:usuarios!leads_dono_id_fkey(id, nome)',
    )
    .order('created_at', { ascending: false });

  if (params.origem) query = query.eq('origem', params.origem);
  if (params.dono) query = query.eq('dono_id', params.dono);

  const { data: leads, error } =
    await query.returns<(LeadCard & { dono: { id: string; nome: string | null } | null })[]>();

  const { data: donosTodos } = await supabase
    .from('usuarios')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome')
    .returns<{ id: string; nome: string | null }[]>();

  const donosNoResultado = Array.from(
    new Map(
      (leads ?? []).filter((l) => l.dono?.id).map((l) => [l.dono!.id, l.dono!.nome ?? '—']),
    ).entries(),
  );

  const temFiltro = Boolean(params.origem || params.dono);

  return (
    <div>
      <SectionHero
        title="CRM"
        subtitle={`${leads?.length ?? 0} lead${(leads?.length ?? 0) === 1 ? '' : 's'} no pipeline · Arraste entre colunas pra mudar status`}
        color="blue"
      />

      <form
        className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
        method="get"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-700">Origem</span>
          <select
            name="origem"
            defaultValue={params.origem ?? ''}
            className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-neutral-900"
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
            className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-neutral-900"
          >
            <option value="">Todos</option>
            {donosNoResultado.map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className={cn(buttonVariants({ variant: 'default' }))}>
            Filtrar
          </button>
          {temFiltro && (
            <Link href="/crm" className={cn(buttonVariants({ variant: 'outline' }))}>
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

      <CrmShell
        leads={leads ?? []}
        donos={donosTodos ?? []}
        meuId={user.id}
        isAdmin={isAdmin}
        podeImportar={meuPerfil?.perfil?.slug === 'admin' || meuPerfil?.perfil?.slug === 'gestao'}
      />
    </div>
  );
}
