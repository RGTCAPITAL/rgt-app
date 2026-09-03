'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Search,
  Sparkles,
  UserPlus,
  XCircle,
  CheckCircle,
  Clock,
  AlertTriangle,
  Filter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { RED_FLAG_LABEL, type RedFlag } from '@/lib/judit/types';
import { enriquecerLoteJudit } from './judit-batch-action';
import { VirarLeadDialog } from './virar-lead-dialog';
import { DescartarDialog } from './descartar-dialog';

type Row = {
  id: string;
  numero_processo: string;
  tribunal: string;
  ente_devedor_nome: string | null;
  valor_face: number | null;
  vencimento_ano: number | null;
  vara_origem: string | null;
  judit_status: string;
  cedente_nome_provavel: string | null;
  advogado_nome: string | null;
  advogado_oab: string | null;
  red_flags: RedFlag[];
  status: string;
  fonte_lote: string;
  lead_id: string | null;
  responsavel_id: string | null;
  qtd_rps: number;
};

type Props = {
  rows: Row[];
  lotes: string[];
  filtros: { lote: string; status: string; q: string };
  role: string;
  juditOn: boolean;
};

const STATUS_LABEL: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  importado: { label: 'Importado', color: 'bg-neutral-100 text-neutral-700', icon: Clock },
  enriquecido: { label: 'Enriquecido', color: 'bg-blue-100 text-blue-700', icon: Sparkles },
  em_prospeccao: {
    label: 'Em prospecção',
    color: 'bg-purple-100 text-purple-700',
    icon: UserPlus,
  },
  lead_criado: { label: 'Virou lead', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  descartado: { label: 'Descartado', color: 'bg-red-100 text-red-700', icon: XCircle },
};

const JUDIT_LABEL: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: 'bg-neutral-100 text-neutral-600' },
  ok: { label: 'Judit OK', color: 'bg-emerald-100 text-emerald-700' },
  not_found: { label: 'Não encontrado', color: 'bg-amber-100 text-amber-800' },
  error: { label: 'Erro', color: 'bg-red-100 text-red-700' },
  skipped: { label: 'Ignorado', color: 'bg-neutral-100 text-neutral-500' },
};

function fmtBRL(v: number | null): string {
  if (v === null) return '—';
  return Number(v).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

export function ProspeccaoTable({ rows, lotes, filtros, role, juditOn }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [dialogLead, setDialogLead] = useState<Row | null>(null);
  const [dialogDescarte, setDialogDescarte] = useState<Row | null>(null);

  const canImport = role === 'admin' || role === 'gestao';
  const canWrite = ['admin', 'gestao', 'broker'].includes(role);

  const pendentesSelecionados = useMemo(
    () =>
      rows.filter((r) => selecionados.has(r.id) && r.judit_status === 'pendente').map((r) => r.id),
    [rows, selecionados],
  );

  function toggle(id: string) {
    const next = new Set(selecionados);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelecionados(next);
  }

  function toggleTodos() {
    if (selecionados.size === rows.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(rows.map((r) => r.id)));
    }
  }

  function selecionarPendentes() {
    setSelecionados(new Set(rows.filter((r) => r.judit_status === 'pendente').map((r) => r.id)));
  }

  function enriquecer() {
    if (pendentesSelecionados.length === 0) {
      toast.error('Selecione ao menos um item pendente pra enriquecer.');
      return;
    }
    startTransition(async () => {
      const res = await enriquecerLoteJudit(pendentesSelecionados);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { ok, not_found, error } = res.data;
      toast.success(
        `Enriquecimento concluído · ${ok} ok · ${not_found} não encontrado · ${error} erro`,
      );
      setSelecionados(new Set());
      router.refresh();
    });
  }

  function updateFiltro(key: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/admin/prospeccao?${params.toString()}`);
  }

  return (
    <>
      {/* Barra de filtros */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-600">Nº Processo</label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-neutral-400" />
              <Input
                defaultValue={filtros.q}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') updateFiltro('q', (e.target as HTMLInputElement).value);
                }}
                placeholder="Buscar (ao menos 3 dígitos)"
                className="h-9 w-56 pl-8 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-600">Lote</label>
            <select
              value={filtros.lote}
              onChange={(e) => updateFiltro('lote', e.target.value)}
              className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-900"
            >
              <option value="">Todos os lotes</option>
              {lotes.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-600">Status</label>
            <select
              value={filtros.status}
              onChange={(e) => updateFiltro('status', e.target.value)}
              className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-900"
            >
              <option value="">Todos</option>
              <option value="importado">Importado</option>
              <option value="enriquecido">Enriquecido</option>
              <option value="em_prospeccao">Em prospecção</option>
              <option value="lead_criado">Virou lead</option>
              <option value="descartado">Descartado</option>
            </select>
          </div>

          <div className="ml-auto flex items-center gap-2 text-sm text-neutral-600">
            <Filter className="size-4" />
            {rows.length} resultado{rows.length === 1 ? '' : 's'}
          </div>
        </div>
      </Card>

      {/* Toolbar de ação em lote */}
      {selecionados.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
          <span className="text-blue-900">
            <strong>{selecionados.size}</strong> selecionado{selecionados.size === 1 ? '' : 's'}
            {pendentesSelecionados.length > 0 && (
              <span className="ml-1 text-blue-700">
                ({pendentesSelecionados.length} pendente
                {pendentesSelecionados.length === 1 ? '' : 's'})
              </span>
            )}
          </span>
          <Button
            size="sm"
            onClick={enriquecer}
            disabled={pending || !juditOn || pendentesSelecionados.length === 0}
            className="ml-auto"
          >
            {pending ? (
              <>
                <Spinner size={3} />
                Enriquecendo…
              </>
            ) : (
              <>
                <Sparkles className="size-3.5" />
                Enriquecer com Judit ({pendentesSelecionados.length})
              </>
            )}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelecionados(new Set())}>
            Limpar
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-neutral-500">
          Nenhum precatório importado ainda. Comece pelo botão &quot;Importar planilha&quot; no
          topo.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {canWrite && (
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        checked={selecionados.size === rows.length && rows.length > 0}
                        onChange={toggleTodos}
                        className="size-4"
                      />
                    </TableHead>
                  )}
                  <TableHead>Nº Processo</TableHead>
                  <TableHead>Cedente</TableHead>
                  <TableHead>Advogado</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Venc</TableHead>
                  <TableHead>Ente</TableHead>
                  <TableHead>Judit</TableHead>
                  <TableHead>Red flags</TableHead>
                  <TableHead>Status</TableHead>
                  {canWrite && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const s = STATUS_LABEL[r.status];
                  const j = JUDIT_LABEL[r.judit_status];
                  const StatusIcon = s?.icon ?? Clock;
                  const isTerminal = r.status === 'lead_criado' || r.status === 'descartado';
                  return (
                    <TableRow key={r.id} className={isTerminal ? 'opacity-60' : ''}>
                      {canWrite && (
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selecionados.has(r.id)}
                            onChange={() => toggle(r.id)}
                            className="size-4"
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-mono text-xs">{r.numero_processo}</TableCell>
                      <TableCell>
                        {r.cedente_nome_provavel ? (
                          <span className="font-medium">{r.cedente_nome_provavel}</span>
                        ) : (
                          <span className="text-xs text-neutral-400 italic">
                            (Judit ainda não rodou)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.advogado_nome ? (
                          <>
                            {r.advogado_nome}
                            {r.advogado_oab && (
                              <span className="text-neutral-500"> · OAB {r.advogado_oab}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        <div>{fmtBRL(r.valor_face)}</div>
                        {r.qtd_rps > 1 && (
                          <div
                            className="text-[10px] font-normal text-blue-600"
                            title="Soma de múltiplos RPs (juros/honorários/principal) do mesmo processo"
                          >
                            {r.qtd_rps} RPs
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{r.vencimento_ano ?? '—'}</TableCell>
                      <TableCell className="text-xs">{r.ente_devedor_nome ?? '—'}</TableCell>
                      <TableCell>
                        {j && (
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${j.color}`}
                          >
                            {j.label}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.red_flags.length === 0 ? (
                          <span className="text-xs text-neutral-400">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {r.red_flags.slice(0, 2).map((f) => (
                              <Badge
                                key={f}
                                variant="outline"
                                className="border-red-200 bg-red-50 text-[10px] text-red-700"
                              >
                                <AlertTriangle className="size-2.5" />
                                {RED_FLAG_LABEL[f] ?? f}
                              </Badge>
                            ))}
                            {r.red_flags.length > 2 && (
                              <span className="text-[10px] text-neutral-500">
                                +{r.red_flags.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {s && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.color}`}
                          >
                            <StatusIcon className="size-3" />
                            {s.label}
                          </span>
                        )}
                      </TableCell>
                      {canWrite && (
                        <TableCell className="text-right">
                          {!isTerminal && (
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDialogLead(r)}
                                className="h-7 text-xs"
                                disabled={!r.cedente_nome_provavel && r.judit_status === 'pendente'}
                                title={
                                  !r.cedente_nome_provavel && r.judit_status === 'pendente'
                                    ? 'Enriqueça com Judit primeiro pra ter o nome'
                                    : ''
                                }
                              >
                                <UserPlus className="size-3" />
                                Virar lead
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDialogDescarte(r)}
                                className="h-7 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                              >
                                <XCircle className="size-3" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {rows.length > 0 && rows.some((r) => r.judit_status === 'pendente') && juditOn && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="ghost" onClick={selecionarPendentes}>
            Selecionar todos os pendentes (
            {rows.filter((r) => r.judit_status === 'pendente').length})
          </Button>
        </div>
      )}

      {!canImport && role === 'broker' && (
        <p className="mt-4 text-xs text-neutral-500 italic">
          Como broker, você trabalha a fila mas não importa planilhas. Peça pra admin/gestão.
        </p>
      )}

      {dialogLead && (
        <VirarLeadDialog
          row={dialogLead}
          onClose={() => setDialogLead(null)}
          onSuccess={() => {
            setDialogLead(null);
            router.refresh();
          }}
        />
      )}
      {dialogDescarte && (
        <DescartarDialog
          row={dialogDescarte}
          onClose={() => setDialogDescarte(null)}
          onSuccess={() => {
            setDialogDescarte(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
