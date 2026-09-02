import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Search, FileText, ArrowLeft, ArrowRight, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { ESFERAS, TIPOS_ATIVO } from './nova/schemas';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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

/** Cores por etapa. Como Badge shadcn cobre só primary/secondary/destructive,
 *  aplicamos classes explícitas para os estados customizados. */
function classesEtapa(etapa: string): string {
  if (etapa === 'finalizada')
    return 'border-transparent bg-emerald-100 text-emerald-800 hover:bg-emerald-100';
  if (etapa === 'cancelada') return 'border-transparent bg-red-100 text-red-800 hover:bg-red-100';
  if (etapa === 'pagamento')
    return 'border-transparent bg-blue-100 text-blue-800 hover:bg-blue-100';
  return 'border-transparent bg-neutral-100 text-neutral-700 hover:bg-neutral-100';
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

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug, permissoes)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string; permissoes: Record<string, unknown> | null } | null }>();
  const podeMunicipal = Boolean(usuario?.perfil?.permissoes?.['pode_esfera_municipal']);
  const esferasVisiveis = podeMunicipal ? ESFERAS : ESFERAS.filter((e) => e.value !== 'municipal');
  const isBroker = usuario?.perfil?.slug === 'broker';

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
    const busca = params.q
      .trim()
      .replace(/[,()*=%_\\"']/g, '')
      .slice(0, 100);
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
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">Operações</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {count === null || count === undefined
              ? 'Gestão de operações de precatórios.'
              : count === 1
                ? '1 operação encontrada.'
                : `${count} operações encontradas.`}
          </p>
        </div>
        <Link href="/operacoes/nova" className={cn(buttonVariants({ size: 'lg' }))}>
          <Plus className="size-4" />
          Nova operação
        </Link>
      </div>

      <form
        className="mt-6 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
        method="get"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-700">Buscar</span>
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                name="q"
                defaultValue={params.q ?? ''}
                placeholder="Nº processo ou nome do cedente"
                className="h-9 w-72 rounded-md border border-neutral-200 bg-white pr-3 pl-8 text-sm text-neutral-900 outline-none focus:border-neutral-900"
              />
            </div>
          </label>
          <FiltroSelect label="Etapa" name="etapa" defaultValue={params.etapa ?? ''}>
            <option value="">Todas</option>
            {ETAPAS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </FiltroSelect>
          <FiltroSelect label="Esfera" name="esfera" defaultValue={params.esfera ?? ''}>
            <option value="">Todas</option>
            {esferasVisiveis.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </FiltroSelect>
          <FiltroSelect label="Tipo" name="tipo" defaultValue={params.tipo ?? ''}>
            <option value="">Todos</option>
            {TIPOS_ATIVO.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </FiltroSelect>
          <div className="flex gap-2">
            <button type="submit" className={cn(buttonVariants({ variant: 'default' }))}>
              Filtrar
            </button>
            {temFiltro && (
              <Link href="/operacoes" className={cn(buttonVariants({ variant: 'outline' }))}>
                Limpar
              </Link>
            )}
          </div>
        </div>
      </form>

      {error && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Erro ao carregar operações: {error.message}
        </div>
      )}

      {!error && operacoes && operacoes.length === 0 && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-white p-12 text-center shadow-sm">
          <div className="flex size-12 items-center justify-center rounded-full bg-neutral-100">
            <FileText className="size-6 text-neutral-500" />
          </div>
          <p className="text-sm text-neutral-600">
            {temFiltro
              ? 'Nenhuma operação encontrada com esses filtros.'
              : 'Nenhuma operação cadastrada ainda.'}
          </p>
          {!temFiltro && (
            <Link
              href="/operacoes/nova"
              className={cn(buttonVariants({ variant: 'default', size: 'lg' }), 'mt-2')}
            >
              <Plus className="size-4" />
              Cadastrar a primeira
            </Link>
          )}
        </div>
      )}

      {!error && operacoes && operacoes.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-neutral-50 hover:bg-neutral-50">
                <TableHead>Nº processo</TableHead>
                <TableHead>Cedente</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Esfera</TableHead>
                <TableHead>Tribunal</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Etapa</TableHead>
                {!isBroker && <TableHead>Dono</TableHead>}
                <TableHead>Atualizado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operacoes.map((op) => (
                <TableRow key={op.id}>
                  <TableCell className="py-3">
                    <Link
                      href={`/operacoes/${op.id}`}
                      className="font-medium text-neutral-900 hover:underline"
                    >
                      {op.numero_processo}
                    </Link>
                  </TableCell>
                  <TableCell className="py-3 text-neutral-700">{op.cedente_nome}</TableCell>
                  <TableCell className="py-3 text-neutral-700">{labelTipo(op.tipo)}</TableCell>
                  <TableCell className="py-3 text-neutral-700 capitalize">{op.esfera}</TableCell>
                  <TableCell
                    className="max-w-[220px] truncate py-3 text-neutral-700"
                    title={op.tribunal}
                  >
                    {op.tribunal}
                  </TableCell>
                  <TableCell className="py-3 text-right font-medium text-neutral-900">
                    {fmtBRL(op.valor_total)}
                  </TableCell>
                  <TableCell className="py-3">
                    <Badge className={classesEtapa(op.etapa_atual)}>
                      {labelEtapa(op.etapa_atual)}
                    </Badge>
                  </TableCell>
                  {!isBroker && (
                    <TableCell className="py-3 text-neutral-700">{op.dono?.nome ?? '—'}</TableCell>
                  )}
                  <TableCell className="py-3 text-neutral-500">{fmtData(op.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 text-sm text-neutral-600">
              <span>
                Página {page} de {totalPaginas}
              </span>
              <div className="flex gap-2">
                <PageLink params={params} page={page - 1} disabled={page === 1}>
                  <ArrowLeft className="size-3.5" />
                  Anterior
                </PageLink>
                <PageLink params={params} page={page + 1} disabled={page === totalPaginas}>
                  Próxima
                  <ArrowRight className="size-3.5" />
                </PageLink>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FiltroSelect({
  label,
  name,
  defaultValue,
  children,
}: {
  label: string;
  name: string;
  defaultValue: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-700">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-neutral-900"
      >
        {children}
      </select>
    </label>
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
      <span
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'pointer-events-none opacity-40',
        )}
      >
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
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
    >
      {children}
    </Link>
  );
}
