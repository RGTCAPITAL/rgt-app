import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ESFERAS, TIPOS_ATIVO } from './nova/schemas';

const ETAPAS = [
  { value: 'precificacao', label: 'Precificação' },
  { value: 'aceite', label: 'Aceite' },
  { value: 'due_diligence_juridica', label: 'DD Jurídica' },
  { value: 'due_diligence_fiscal', label: 'DD Fiscal' },
  { value: 'analise_investimento', label: 'Análise de investimento' },
  { value: 'cartorio', label: 'Cartório' },
  { value: 'pagamento', label: 'Pagamento' },
  { value: 'finalizada', label: 'Finalizada' },
  { value: 'cancelada', label: 'Cancelada' },
] as const;

const PAGE_SIZE = 25;

type SearchParams = {
  etapa?: string;
  esfera?: string;
  tipo?: string;
  q?: string;
  page?: string;
};

type OperacaoRow = {
  id: string;
  numero_processo: string;
  cedente_nome: string;
  tribunal: string;
  esfera: string;
  tipo: string;
  valor_total: number;
  etapa_atual: string;
  updated_at: string;
  dono: { nome: string | null } | null;
};

function fmtBRL(v: number): string {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function labelEtapa(v: string): string {
  return ETAPAS.find((e) => e.value === v)?.label ?? v;
}

function labelTipo(v: string): string {
  return TIPOS_ATIVO.find((t) => t.value === v)?.label ?? v;
}

function corEtapa(etapa: string): string {
  if (etapa === 'finalizada') return 'bg-emerald-100 text-emerald-800';
  if (etapa === 'cancelada') return 'bg-red-100 text-red-800';
  if (etapa === 'pagamento') return 'bg-blue-100 text-blue-800';
  return 'bg-neutral-100 text-neutral-700';
}

export default async function OperacoesPage({
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

  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('operacoes')
    .select(
      'id, numero_processo, cedente_nome, tribunal, esfera, tipo, valor_total, etapa_atual, updated_at, dono:usuarios!operacoes_dono_id_fkey(nome)',
      { count: 'exact' },
    )
    .order('updated_at', { ascending: false })
    .range(from, to);

  if (params.etapa) query = query.eq('etapa_atual', params.etapa);
  if (params.esfera) query = query.eq('esfera', params.esfera);
  if (params.tipo) query = query.eq('tipo', params.tipo);
  if (params.q) {
    const busca = params.q.trim();
    if (busca) {
      query = query.or(`numero_processo.ilike.%${busca}%,cedente_nome.ilike.%${busca}%`);
    }
  }

  const { data: operacoes, count, error } = await query.returns<OperacaoRow[]>();

  const totalPaginas = count ? Math.max(1, Math.ceil(count / PAGE_SIZE)) : 1;
  const temFiltro = Boolean(params.etapa || params.esfera || params.tipo || params.q);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Operações</h1>
          <p className="mt-2 text-sm text-neutral-600">
            {count === null || count === undefined
              ? 'Gestão de operações de precatórios.'
              : count === 1
                ? '1 operação encontrada.'
                : `${count} operações encontradas.`}
          </p>
        </div>
        <Link
          href="/operacoes/nova"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          + Nova operação
        </Link>
      </div>

      <form className="mt-6 flex flex-wrap items-end gap-3 rounded-md border border-neutral-200 bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-700">Buscar</span>
          <input
            type="text"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Nº processo ou nome do cedente"
            className="w-72 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-700">Etapa</span>
          <select
            name="etapa"
            defaultValue={params.etapa ?? ''}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900"
          >
            <option value="">Todas</option>
            {ETAPAS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-700">Esfera</span>
          <select
            name="esfera"
            defaultValue={params.esfera ?? ''}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900"
          >
            <option value="">Todas</option>
            {ESFERAS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-700">Tipo</span>
          <select
            name="tipo"
            defaultValue={params.tipo ?? ''}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900"
          >
            <option value="">Todos</option>
            {TIPOS_ATIVO.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Filtrar
          </button>
          {temFiltro && (
            <Link
              href="/operacoes"
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Limpar
            </Link>
          )}
        </div>
      </form>

      {error && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Erro ao carregar operações: {error.message}
        </div>
      )}

      {!error && operacoes && operacoes.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-neutral-300 bg-white p-10 text-center">
          <p className="text-sm text-neutral-600">
            {temFiltro
              ? 'Nenhuma operação encontrada com esses filtros.'
              : 'Nenhuma operação cadastrada ainda.'}
          </p>
          {!temFiltro && (
            <Link
              href="/operacoes/nova"
              className="mt-4 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
            >
              Cadastrar a primeira
            </Link>
          )}
        </div>
      )}

      {!error && operacoes && operacoes.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-md border border-neutral-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <Th>Nº processo</Th>
                  <Th>Cedente</Th>
                  <Th>Tipo</Th>
                  <Th>Esfera</Th>
                  <Th>Tribunal</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Etapa</Th>
                  <Th>Dono</Th>
                  <Th>Atualizado</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {operacoes.map((op) => (
                  <tr key={op.id} className="hover:bg-neutral-50">
                    <Td>
                      <Link
                        href={`/operacoes/${op.id}`}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {op.numero_processo}
                      </Link>
                    </Td>
                    <Td className="text-neutral-700">{op.cedente_nome}</Td>
                    <Td className="text-neutral-700">{labelTipo(op.tipo)}</Td>
                    <Td className="text-neutral-700 capitalize">{op.esfera}</Td>
                    <Td className="max-w-[200px] truncate text-neutral-700" title={op.tribunal}>
                      {op.tribunal}
                    </Td>
                    <Td className="text-right font-medium text-neutral-900">
                      {fmtBRL(op.valor_total)}
                    </Td>
                    <Td>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${corEtapa(op.etapa_atual)}`}
                      >
                        {labelEtapa(op.etapa_atual)}
                      </span>
                    </Td>
                    <Td className="text-neutral-700">{op.dono?.nome ?? '—'}</Td>
                    <Td className="text-neutral-500">{fmtData(op.updated_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 text-sm text-neutral-600">
              <span>
                Página {page} de {totalPaginas}
              </span>
              <div className="flex gap-2">
                <PageLink params={params} page={page - 1} disabled={page === 1}>
                  ← Anterior
                </PageLink>
                <PageLink params={params} page={page + 1} disabled={page === totalPaginas}>
                  Próxima →
                </PageLink>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 font-medium ${className ?? ''}`}>{children}</th>;
}

function Td({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <td className={`px-4 py-3 ${className ?? ''}`} title={title}>
      {children}
    </td>
  );
}

function PageLink({
  params,
  page,
  disabled,
  children,
}: {
  params: SearchParams;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="rounded-md border border-neutral-200 px-3 py-1.5 text-neutral-400">
        {children}
      </span>
    );
  }
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.etapa) search.set('etapa', params.etapa);
  if (params.esfera) search.set('esfera', params.esfera);
  if (params.tipo) search.set('tipo', params.tipo);
  search.set('page', String(page));
  return (
    <Link
      href={`/operacoes?${search.toString()}`}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-neutral-700 hover:bg-neutral-100"
    >
      {children}
    </Link>
  );
}
