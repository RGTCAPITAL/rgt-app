'use client';

import { Fragment, useMemo, useState, useTransition } from 'react';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { infoRedFlag, ordenarFlagsParaExibir, temAlertaGrave } from '@/lib/djen/red-flags';
import {
  GRUPO_TEXTO,
  grupoFila,
  ordenarParaFila,
  proximoPasso,
  resumoGrupos,
  type GrupoFila,
  type VisaoProspeccao,
} from '@/lib/prospeccao/fila';
import { enriquecerLoteDjen } from './djen-batch-action';
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
  red_flags: string[];
  status: string;
  fonte_lote: string;
  lead_id: string | null;
  responsavel_id: string | null;
  qtd_rps: number;
};

type Props = {
  rows: Row[];
  lotes: string[];
  filtros: { lote: string; status: string; q: string; visao: VisaoProspeccao };
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

// Alerta grave (cessão, FIDC, penhora, pagamento) sai em preto: é o selo que
// mais pesa e a paleta é P&B. Fora dos graves, a única flag vermelha do
// catálogo é a X7 — boilerplate do art. 100 §14 que sai em toda expedição —,
// então "vermelho" que não é grave cai no cinza em vez de gritar mais alto que
// uma cessão de verdade. Amarelo continua sendo o aviso de atenção.
const SELO_GRAVE_CLS = 'border-neutral-900 bg-neutral-900 text-white';

const RED_FLAG_COR_CLS: Record<'vermelho' | 'amarelo' | 'cinza', string> = {
  vermelho: 'border-neutral-200 bg-neutral-50 text-neutral-700',
  amarelo: 'border-amber-200 bg-amber-50 text-amber-800',
  cinza: 'border-neutral-200 bg-neutral-50 text-neutral-700',
};

// Quantos selos cabem na célula antes do "+N".
const MAX_SELOS = 4;

/**
 * Selos que aparecem na célula, já na ordem de ordenarFlagsParaExibir. Se a
 * linha tem 4 ou mais alertas graves, o X1 cairia no "+N" — então ele toma o
 * último lugar: é o sinal positivo (ofício expedido) e não pode sumir, e os
 * graves que sobram na tela já bastam pra mandar conferir.
 */
function selosVisiveis(flags: readonly string[]): string[] {
  const visiveis = flags.slice(0, MAX_SELOS);
  if (flags.includes('X1') && !visiveis.includes('X1')) visiveis[MAX_SELOS - 1] = 'X1';
  return visiveis;
}

const RED_FLAG_CAT_LABEL: Record<'BLOQUEADOR' | 'PRICING' | 'NAVEGACIONAL', string> = {
  BLOQUEADOR: 'Bloqueia a compra',
  PRICING: 'Afeta o preço',
  NAVEGACIONAL: 'Info',
};

// A coluna no banco ainda se chama judit_status (herança do batch da Judit),
// mas hoje quem grava é o batch do DJEN — o rótulo na tela acompanha a fonte.
const DJEN_LABEL: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: 'bg-neutral-100 text-neutral-600' },
  ok: { label: 'DJEN OK', color: 'bg-emerald-100 text-emerald-700' },
  not_found: { label: 'Não encontrado', color: 'bg-amber-100 text-amber-800' },
  error: { label: 'Erro', color: 'bg-red-100 text-red-700' },
  skipped: { label: 'Ignorado', color: 'bg-neutral-100 text-neutral-500' },
};

/**
 * O que mostrar na célula do cedente quando não há nome. As três situações
 * pedem ações diferentes do broker: esperar o enriquecimento, buscar o
 * processo por outro caminho, ou ir pelo advogado.
 */
function textoSemCedente(djenStatus: string): string {
  if (djenStatus === 'not_found') return '(Sem publicação no DJEN)';
  if (djenStatus === 'ok') return '(Credor não identificado)';
  return '(Ainda não enriquecido)';
}

// Cabeçalho de bloco da fila: cinza nos blocos que dá pra ligar, amarelo no
// "conferir antes de ligar". O hover fixo evita a linha-título piscar como se
// fosse clicável.
const GRUPO_CLS: Record<GrupoFila, string> = {
  oficio: 'bg-neutral-50 text-neutral-900 hover:bg-neutral-50',
  outros: 'bg-neutral-50 text-neutral-900 hover:bg-neutral-50',
  conferir: 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-50',
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
  // Mesma lista do exigirPerfil em enriquecerLoteDjen: a action recusa broker,
  // então o botão nem aparece pra ele. A seleção de linhas só existe pra
  // alimentar esse lote, e some junto — broker com checkbox e uma barra que
  // só tem "Limpar" era convite a achar que algo estava quebrado.
  const canEnriquecer = ['admin', 'gestao', 'juridico'].includes(role);

  const naFila = filtros.visao === 'fila';
  const temFiltro = Boolean(filtros.lote || filtros.status || filtros.q);

  // Na fila, as linhas vêm agrupadas (ofício → outros → conferir) mantendo a
  // ordem de valor do servidor dentro de cada bloco. Em "todos", fica como veio.
  const linhas = useMemo(() => (naFila ? ordenarParaFila(rows) : rows), [naFila, rows]);
  const resumo = useMemo(() => resumoGrupos(rows), [rows]);

  // Colunas fixas: processo, cedente, advogado, valor, devedor, DJEN, red
  // flags, status. A linha-título do bloco precisa cobrir a tabela inteira.
  const totalColunas = 8 + (canEnriquecer ? 1 : 0) + (canWrite ? 1 : 0);

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
      const res = await enriquecerLoteDjen(pendentesSelecionados);
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
                  if (e.key !== 'Enter') return;
                  const bruto = (e.target as HTMLInputElement).value;
                  // O servidor ignora busca com menos de 3 dígitos. Antes o Enter
                  // simplesmente não fazia nada e o campo parecia quebrado.
                  const digitos = bruto.replace(/\D/g, '');
                  if (bruto.trim() && digitos.length < 3) {
                    toast.error('Digite ao menos 3 dígitos do número do processo.');
                    return;
                  }
                  updateFiltro('q', bruto);
                }}
                placeholder="Buscar (ao menos 3 dígitos)"
                className="h-9 w-56 pl-8 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-600">Visão</label>
            <select
              value={filtros.visao}
              onChange={(e) => {
                const params = new URLSearchParams(sp.toString());
                params.set('visao', e.target.value);
                // A fila tira quem virou lead ou foi descartado. Vindo de
                // "todos" com um desses status no filtro, a tabela abria vazia
                // e o select de status ficava preso numa opção desativada.
                const status = params.get('status');
                if (
                  e.target.value === 'fila' &&
                  (status === 'lead_criado' || status === 'descartado')
                )
                  params.delete('status');
                router.push(`/admin/prospeccao?${params.toString()}`);
              }}
              className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-900"
            >
              <option value="fila">Fila do broker</option>
              <option value="todos">Todos os processos</option>
            </select>
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
              {/* A fila já tira quem virou lead ou foi descartado; escolher um
                  desses status nela só devolveria a tabela vazia. */}
              <option value="lead_criado" disabled={naFila}>
                Virou lead
              </option>
              <option value="descartado" disabled={naFila}>
                Descartado
              </option>
            </select>
          </div>

          <div className="ml-auto flex items-center gap-2 text-sm text-neutral-600">
            <Filter className="size-4" />
            {rows.length} resultado{rows.length === 1 ? '' : 's'}
          </div>
        </div>
      </Card>

      {/* Toolbar de ação em lote */}
      {canEnriquecer && selecionados.size > 0 && (
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
                Enriquecer com DJEN ({pendentesSelecionados.length})
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
          {temFiltro ? (
            'Nenhum processo com esse filtro.'
          ) : naFila ? (
            // Broker abre na fila sem ter escolhido filtro nenhum: "com esse
            // filtro" fazia parecer que ele tinha filtrado algo.
            'A fila está vazia: nenhum processo esperando ligação.'
          ) : (
            <>
              Nenhum precatório importado ainda. Comece pelo botão &quot;Importar planilha&quot; no
              topo.
            </>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {canEnriquecer && (
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
                  <TableHead>Devedor</TableHead>
                  <TableHead>DJEN</TableHead>
                  <TableHead>Red flags</TableHead>
                  <TableHead>Status</TableHead>
                  {canWrite && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((r, i) => {
                  const s = STATUS_LABEL[r.status];
                  const j = DJEN_LABEL[r.judit_status];
                  const StatusIcon = s?.icon ?? Clock;
                  const isTerminal = r.status === 'lead_criado' || r.status === 'descartado';
                  // Grave primeiro, depois o X1: o corte em MAX_SELOS não pode
                  // esconder a cessão nem o ofício atrás do "+N".
                  const flags = ordenarFlagsParaExibir(r.red_flags);
                  const selos = selosVisiveis(flags);
                  const cedente = r.cedente_nome_provavel?.trim();
                  // Linha que já virou lead ou foi descartada (aparece em "todos")
                  // não tem ligação pela frente — o passo seria ruído.
                  const passo = isTerminal ? null : proximoPasso(r);
                  // Grave e espólio mudam com quem o broker fala (ou se fala):
                  // esses saem em amarelo; os outros passos são orientação. O
                  // espólio é reconhecido pela frase de proximoPasso, que começa
                  // com "Espólio:" — fila.ts não expõe o tipo do passo.
                  const passoAtencao =
                    passo !== null && (temAlertaGrave(r.red_flags) || /^esp[óo]lio/i.test(passo));
                  const grupo = naFila ? grupoFila(r) : null;
                  const abreGrupo =
                    grupo !== null && (i === 0 || grupoFila(linhas[i - 1]) !== grupo);
                  return (
                    <Fragment key={r.id}>
                      {grupo !== null && abreGrupo && (
                        <TableRow className={GRUPO_CLS[grupo]}>
                          <TableCell colSpan={totalColunas} className="py-2.5 whitespace-normal">
                            <div className="flex items-center gap-1.5 text-sm font-semibold">
                              {grupo === 'conferir' && (
                                <AlertTriangle className="size-4 shrink-0" />
                              )}
                              <span>
                                {GRUPO_TEXTO[grupo].titulo} · {resumo[grupo].qtd}{' '}
                                {resumo[grupo].qtd === 1 ? 'processo' : 'processos'} ·{' '}
                                {fmtBRL(resumo[grupo].soma)}
                              </span>
                            </div>
                            <div
                              className={`mt-0.5 text-xs ${grupo === 'conferir' ? 'text-amber-800' : 'text-neutral-500'}`}
                            >
                              {GRUPO_TEXTO[grupo].subtitulo}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow className={isTerminal ? 'opacity-60' : ''}>
                        {canEnriquecer && (
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
                        {/* Nome e advogado quebram linha: em nowrap, um nome longo com OAB
                          esticava a tabela para 1555px e ela não cabia na tela do Mac. */}
                        <TableCell className="max-w-56 min-w-36 whitespace-normal">
                          {cedente ? (
                            <span className="font-medium">{cedente}</span>
                          ) : (
                            <span className="text-xs text-neutral-400 italic">
                              {textoSemCedente(r.judit_status)}
                            </span>
                          )}
                          {passo && (
                            <div
                              className={`mt-0.5 text-xs ${passoAtencao ? 'text-amber-800' : 'text-neutral-500'}`}
                            >
                              {passo}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-52 min-w-32 text-xs whitespace-normal">
                          {r.advogado_nome ? (
                            <>
                              <div>{r.advogado_nome}</div>
                              {r.advogado_oab && (
                                <div className="text-[10px] text-neutral-500">
                                  OAB {r.advogado_oab}
                                </div>
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
                        <TableCell className="text-xs">
                          <div>{r.ente_devedor_nome ?? '—'}</div>
                          {r.vencimento_ano && (
                            <div className="text-[10px] text-neutral-500">
                              venc. {r.vencimento_ano}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {j && (
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${j.color}`}
                            >
                              {j.label}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-36 whitespace-normal">
                          {r.red_flags.length === 0 ? (
                            <span className="text-xs text-neutral-400">—</span>
                          ) : (
                            <TooltipProvider delay={200}>
                              <div className="flex flex-wrap gap-1">
                                {selos.map((f) => {
                                  const info = infoRedFlag(f);
                                  const cls = temAlertaGrave([f])
                                    ? SELO_GRAVE_CLS
                                    : RED_FLAG_COR_CLS[info.cor];
                                  return (
                                    <Tooltip key={f}>
                                      <TooltipTrigger
                                        render={
                                          <Badge
                                            variant="outline"
                                            className={`cursor-help text-[10px] ${cls}`}
                                          />
                                        }
                                      >
                                        <AlertTriangle className="size-2.5" />
                                        {f}
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs">
                                        <div className="space-y-1">
                                          <div className="font-semibold">
                                            {info.descricaoHumana}
                                          </div>
                                          <div className="text-[10px] opacity-70">
                                            Código {info.codigo} ·{' '}
                                            {RED_FLAG_CAT_LABEL[info.categoria]}
                                          </div>
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                })}
                                {flags.length > selos.length && (
                                  <span className="text-[10px] text-neutral-500">
                                    +{flags.length - selos.length}
                                  </span>
                                )}
                              </div>
                            </TooltipProvider>
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
                                  disabled={
                                    !r.cedente_nome_provavel && r.judit_status === 'pendente'
                                  }
                                  title={
                                    !r.cedente_nome_provavel && r.judit_status === 'pendente'
                                      ? 'Enriqueça pelo DJEN primeiro pra ter o nome'
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
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {canEnriquecer &&
        rows.length > 0 &&
        rows.some((r) => r.judit_status === 'pendente') &&
        juditOn && (
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
