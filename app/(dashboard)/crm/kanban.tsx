'use client';

import { useState, useSyncExternalStore, useTransition } from 'react';
import {
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  ChevronsLeft,
  ChevronsRight,
  Send,
} from 'lucide-react';
import { IconeWhatsApp } from '@/components/ui/icone-whatsapp';
import { mudarStatusLead } from './actions';
import { toast } from 'sonner';
import { STATUS_LEAD, labelOrigem, type StatusLead } from '@/lib/leads';
import { LeadForm, type DonoOption, type LeadEdit } from './lead-form';
import { DialogRetorno } from './dialog-retorno';
import { DialogDisparo } from './dialog-disparo';
import {
  escolherModelo,
  linkWhatsAppComTexto,
  montarMensagem,
  type ModeloMensagem,
} from '@/lib/crm/mensagem';
import { Badge } from '@/components/ui/badge';
import { SeloExemplo } from '@/components/ui/selo-exemplo';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { hojeEmSaoPaulo } from '@/lib/datas';
import { fmtTelefone } from '@/lib/formatters';

export type LeadCard = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  cpf_cnpj: string | null;
  origem: string;
  status: StatusLead;
  created_at: string;
  motivo_perda: string | null;
  operacao_id: string | null;
  dono_id: string | null;
  notas: string | null;
  is_exemplo: boolean;
  valor_processo: number | null;
  valor_proposta_indicativa: number | null;
  ente_devedor: string | null;
  numero_processo: string | null;
  retornos: { id: string; titulo: string; prazo: string | null }[];
  dono: { nome: string | null } | null;
};

// Fuso fixo: o servidor da Vercel roda em UTC, e sem isso a data de um lead
// criado à noite sairia diferente no HTML do servidor e no navegador.
const dataSP = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });
const diaMesSP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
});

/** "há 3 dias". O "3d" de antes não dizia se era tempo passado ou prazo. */
function fmtRel(iso: string): string {
  const d = new Date(iso);
  const diffH = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60));
  if (diffH < 1) return 'agora';
  if (diffH < 24) return `há ${diffH} h`;
  const dd = Math.floor(diffH / 24);
  if (dd < 30) return dd === 1 ? 'há 1 dia' : `há ${dd} dias`;
  return diaMesSP.format(d);
}

function iniciais(nome: string | null): string {
  if (!nome) return '?';
  return nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** 187430 vira "R$ 187,4 mil" — card não comporta valor por extenso. */
function fmtBRLCompacto(v: number | null): string {
  if (v === null) return '—';
  if (v >= 1_000_000) return 'R$ ' + (v / 1_000_000).toFixed(1).replace('.', ',') + ' mi';
  if (v >= 1_000) return 'R$ ' + (v / 1_000).toFixed(0) + ' mil';
  return 'R$ ' + v.toFixed(0);
}

/** O retorno pendente mais próximo, e se já passou do prazo. */
function proximoRetornoDe(
  retornos: { id: string; titulo: string; prazo: string | null }[],
): { titulo: string; quando: string; atrasado: boolean } | null {
  const comPrazo = retornos.filter((r) => r.prazo).sort((a, b) => a.prazo!.localeCompare(b.prazo!));
  const r = comPrazo[0];
  if (!r) return null;
  const hoje = hojeEmSaoPaulo();
  const [, mes, dia] = r.prazo!.split('-');
  return {
    titulo: r.titulo,
    quando: r.prazo === hoje ? 'hoje' : dia + '/' + mes,
    atrasado: r.prazo! < hoje,
  };
}

const COLUNA_BORDER: Record<string, string> = {
  novo: 'border-t-neutral-400',
  em_contato: 'border-t-blue-500',
  qualificado: 'border-t-amber-500',
  proposta_enviada: 'border-t-violet-500',
  ganho: 'border-t-emerald-500',
  perdido: 'border-t-rose-500',
};

/**
 * Fim do funil. No desktop elas ficam recolhidas numa faixa fina, e a largura
 * que sobra vai pras quatro colunas de trabalho — com seis colunas iguais o
 * cartão tinha 140px de texto útil e não dava pra ler. A faixa continua
 * recebendo o cartão arrastado.
 */
const RECOLHIVEIS: readonly StatusLead[] = ['ganho', 'perdido'];

// Quais delas o usuário deixou abertas, guardado neste navegador. Fica num
// store externo (e não em useState + useEffect) para o servidor e a primeira
// pintura usarem "todas recolhidas" e o React trocar pelo valor salvo sem erro
// de hidratação. A variável em memória cobre navegador sem localStorage.
const CHAVE_COLUNAS_ABERTAS = 'crm.colunasAbertas';
const EVENTO_COLUNAS_ABERTAS = 'crm:colunas-abertas';
let colunasAbertasEmMemoria = '';

function lerColunasAbertas(): string {
  try {
    return localStorage.getItem(CHAVE_COLUNAS_ABERTAS) ?? colunasAbertasEmMemoria;
  } catch {
    return colunasAbertasEmMemoria;
  }
}

function gravarColunasAbertas(valor: string) {
  colunasAbertasEmMemoria = valor;
  try {
    localStorage.setItem(CHAVE_COLUNAS_ABERTAS, valor);
  } catch {
    // Sem localStorage: a escolha vale até recarregar a página.
  }
  window.dispatchEvent(new Event(EVENTO_COLUNAS_ABERTAS));
}

function assinarColunasAbertas(avisar: () => void) {
  window.addEventListener(EVENTO_COLUNAS_ABERTAS, avisar);
  window.addEventListener('storage', avisar);
  return () => {
    window.removeEventListener(EVENTO_COLUNAS_ABERTAS, avisar);
    window.removeEventListener('storage', avisar);
  };
}

export function Kanban({
  leads,
  modelos,
  donos,
  meuId,
  isAdmin,
  abrirNovo,
  onNovoFechado,
}: {
  leads: LeadCard[];
  modelos: ModeloMensagem[];
  donos: DonoOption[];
  meuId: string;
  isAdmin: boolean;
  abrirNovo: boolean;
  onNovoFechado: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<StatusLead | null>(null);
  const [leadRetorno, setLeadRetorno] = useState<{ id: string; nome: string } | null>(null);
  const [leadDisparo, setLeadDisparo] = useState<{ id: string; nome: string } | null>(null);
  const [modalPerdido, setModalPerdido] = useState<{ leadId: string; nome: string } | null>(null);
  const [motivoPerda, setMotivoPerda] = useState('');
  const [editandoLead, setEditandoLead] = useState<LeadEdit | null>(null);
  // Card fica em estado de carregando enquanto o servidor não confirma: sem isso
  // ele permanecia visualmente na coluna antiga por ~500ms, sem sinal nenhum.
  const [movendoId, setMovendoId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const abertas = useSyncExternalStore(assinarColunasAbertas, lerColunasAbertas, () => '')
    .split(',')
    .filter(Boolean);
  const recolhida = (v: StatusLead) => RECOLHIVEIS.includes(v) && !abertas.includes(v);
  function alternarColuna(v: StatusLead) {
    const novas = abertas.includes(v) ? abertas.filter((x) => x !== v) : [...abertas, v];
    gravarColunasAbertas(novas.join(','));
  }
  // minmax(0, 1fr) e não 1fr: com 1fr um e-mail comprido alargaria a coluna.
  const colunasLg = STATUS_LEAD.map((c) => (recolhida(c.value) ? '2.75rem' : 'minmax(0,1fr)')).join(
    ' ',
  );

  function onDragStart(e: React.DragEvent, leadId: string) {
    e.dataTransfer.setData('text/plain', leadId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: React.DragEvent, col: StatusLead) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(col);
  }

  function onDragLeave(e: React.DragEvent) {
    // dragleave também dispara ao passar de um elemento pra outro dentro da
    // coluna, e o destaque piscava. Só apaga quando o ponteiro sai de fato.
    // (No Safari relatedTarget vem null, e aí apaga como antes.)
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOverCol(null);
  }

  function onDrop(e: React.DragEvent, novoStatus: StatusLead) {
    e.preventDefault();
    setDragOverCol(null);
    const leadId = e.dataTransfer.getData('text/plain');
    if (!leadId) return;

    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === novoStatus) return;

    if (novoStatus === 'perdido') {
      setModalPerdido({ leadId, nome: lead.nome });
      setMotivoPerda('');
      return;
    }

    // 'ganho' só existe passando pelo formulário de operação — o server rejeita
    // o atalho. Antes o drop era aceito, ia até o servidor e voltava com erro:
    // agora explicamos na hora e apontamos o caminho certo.
    if (novoStatus === 'ganho') {
      toast.error('Pra marcar como Ganho, use "Virar operação" no card do lead.', {
        description: 'O lead só vira ganho quando a operação é criada de fato.',
      });
      return;
    }

    aplicarStatus(leadId, novoStatus, undefined, lead.nome);
  }

  function aplicarStatus(
    leadId: string,
    novoStatus: StatusLead,
    motivo?: string,
    nomeLead?: string,
  ) {
    setErro(null);
    setMovendoId(leadId);
    const destino = STATUS_LEAD.find((s) => s.value === novoStatus)?.label ?? novoStatus;
    startTransition(async () => {
      const res = await mudarStatusLead(leadId, novoStatus, motivo);
      setMovendoId(null);
      if (!res.ok) {
        setErro(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(nomeLead ? `${nomeLead} → ${destino}` : `Lead movido para ${destino}`);
    });
  }

  function confirmarPerda() {
    if (!modalPerdido) return;
    if (!motivoPerda.trim()) {
      setErro('Informe o motivo da perda.');
      return;
    }
    aplicarStatus(modalPerdido.leadId, 'perdido', motivoPerda, modalPerdido.nome);
    setModalPerdido(null);
  }

  return (
    <div>
      {erro && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {erro}
        </div>
      )}

      <div
        className="grid grid-cols-1 gap-3 lg:grid-cols-(--colunas-kanban)"
        style={{ '--colunas-kanban': colunasLg } as React.CSSProperties}
      >
        {STATUS_LEAD.map((col) => {
          const leadsDaCol = leads.filter((l) => l.status === col.value);
          const highlight = dragOverCol === col.value;
          const fechada = recolhida(col.value);
          const qtd = `${leadsDaCol.length} lead${leadsDaCol.length === 1 ? '' : 's'}`;
          return (
            <div
              key={col.value}
              onDragOver={(e) => onDragOver(e, col.value)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, col.value)}
              className={cn(
                'flex min-h-[60vh] flex-col rounded-lg border border-t-4 bg-white/70 p-2 transition-colors',
                COLUNA_BORDER[col.value] ?? 'border-t-neutral-400',
                highlight ? 'border-neutral-900 bg-neutral-100' : 'border-neutral-200',
                fechada && 'lg:p-0',
              )}
            >
              {/* Faixa recolhida (só desktop). Os handlers de arrastar estão na
                  div de fora, então soltar aqui funciona igual à coluna aberta. */}
              {fechada && (
                <button
                  type="button"
                  onClick={() => alternarColuna(col.value)}
                  aria-expanded={false}
                  aria-label={`Mostrar coluna ${col.label} (${qtd})`}
                  title={`Mostrar coluna ${col.label} (${qtd})`}
                  className="hidden flex-1 flex-col items-center rounded-b-md py-3 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 lg:flex"
                >
                  <span className="sticky top-4 flex flex-col items-center gap-3">
                    <span
                      className={cn(
                        'flex size-6 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                        leadsDaCol.length > 0
                          ? 'bg-neutral-900 text-white'
                          : 'bg-neutral-100 text-neutral-400',
                      )}
                    >
                      {leadsDaCol.length}
                    </span>
                    <span className="rotate-180 text-xs font-medium [writing-mode:vertical-rl]">
                      {col.label}
                    </span>
                    <ChevronsLeft className="size-3.5" />
                  </span>
                </button>
              )}

              <div
                className={cn(
                  'mb-2 flex items-center justify-between px-1',
                  fechada && 'lg:hidden',
                )}
              >
                <Badge
                  className={cn(
                    'border-transparent',
                    leadsDaCol.length === 0 ? col.corVazio : col.cor,
                  )}
                >
                  {col.label}
                </Badge>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-neutral-500">{leadsDaCol.length}</span>
                  {RECOLHIVEIS.includes(col.value) && (
                    <button
                      type="button"
                      onClick={() => alternarColuna(col.value)}
                      aria-label={`Recolher coluna ${col.label}`}
                      title="Recolher coluna"
                      className="hidden rounded p-0.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 lg:inline-flex"
                    >
                      <ChevronsRight className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className={cn('flex-1 space-y-2.5 overflow-y-auto', fechada && 'lg:hidden')}>
                {leadsDaCol.length === 0 ? (
                  // Antes era só um "—" cinza, que não dizia o que fazer.
                  <div className="mt-3 rounded-lg border border-dashed border-neutral-200 px-3 py-6 text-center">
                    <p className="text-xs text-neutral-400">
                      {col.value === 'novo'
                        ? 'Nenhum lead novo. Crie um em "Novo lead" ou importe um CSV.'
                        : 'Arraste um card até aqui.'}
                    </p>
                  </div>
                ) : (
                  leadsDaCol.map((lead) => {
                    const proximoRetorno = proximoRetornoDe(lead.retornos ?? []);
                    // A mensagem é montada por lead: o modelo escolhido é o
                    // mais completo que os dados DESTE lead sustentam.
                    const dadosMsg = {
                      nome: lead.nome,
                      valorProposta: lead.valor_proposta_indicativa,
                      valorProcesso: lead.valor_processo,
                      numeroProcesso: lead.numero_processo,
                      enteDevedor: lead.ente_devedor,
                    };
                    const modelo = escolherModelo(modelos, dadosMsg);
                    const linkZap = lead.telefone
                      ? linkWhatsAppComTexto(
                          lead.telefone,
                          modelo ? montarMensagem(modelo.texto, dadosMsg) : '',
                        )
                      : null;
                    return (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={(e) => onDragStart(e, lead.id)}
                        onClick={() =>
                          setEditandoLead({
                            id: lead.id,
                            nome: lead.nome,
                            telefone: lead.telefone,
                            email: lead.email,
                            cpf_cnpj: lead.cpf_cnpj,
                            origem: lead.origem,
                            dono_id: lead.dono_id,
                            notas: lead.notas,
                            status: lead.status,
                            operacao_id: lead.operacao_id,
                            motivo_perda: lead.motivo_perda,
                            ente_devedor: lead.ente_devedor,
                            numero_processo: lead.numero_processo,
                            valor_processo: lead.valor_processo,
                          })
                        }
                        className={cn(
                          'group cursor-grab rounded-lg bg-white p-3 text-sm shadow-sm ring-1 ring-neutral-200 transition-shadow hover:shadow-md active:cursor-grabbing',
                          movendoId === lead.id && 'pointer-events-none animate-pulse opacity-50',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 text-[15px] leading-snug font-semibold break-words text-neutral-900">
                            {lead.nome}
                            {lead.is_exemplo && <SeloExemplo className="ml-1.5 align-middle" />}
                          </span>
                          {/* O texto vem de Date.now(): se o servidor renderiza
                              às 10h59 e o browser hidrata às 11h00, "há 3 h"
                              vira "há 4 h" e o React reclama de divergência.
                              O valor certo é sempre o do cliente. */}
                          <span
                            suppressHydrationWarning
                            title={`Entrou no CRM em ${dataSP.format(new Date(lead.created_at))}`}
                            className="mt-0.5 shrink-0 text-xs text-neutral-500"
                          >
                            {fmtRel(lead.created_at)}
                          </span>
                        </div>
                        {/* Telefone e e-mail em linhas próprias: lado a lado, o
                            e-mail era picado no meio em duas ou três linhas. */}
                        {lead.telefone && (
                          <div className="mt-1 text-[13px] text-neutral-700 tabular-nums">
                            {fmtTelefone(lead.telefone)}
                          </div>
                        )}
                        {lead.email && (
                          <div
                            title={lead.email}
                            className={cn(
                              'truncate text-[13px] text-neutral-600',
                              !lead.telefone && 'mt-1',
                            )}
                          >
                            {lead.email}
                          </div>
                        )}
                        {/*
                        Valor no card. Kanban sem dinheiro é lista de nomes:
                        o usuário não consegue priorizar sem abrir cada um.
                      */}
                        {(lead.valor_proposta_indicativa !== null ||
                          lead.valor_processo !== null) && (
                          <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-neutral-100 pt-2">
                            <span className="text-xs text-neutral-500">
                              {lead.valor_proposta_indicativa !== null ? 'Proposta' : 'Processo'}
                            </span>
                            <span className="text-sm font-semibold text-neutral-900 tabular-nums">
                              {fmtBRLCompacto(
                                lead.valor_proposta_indicativa ?? lead.valor_processo,
                              )}
                            </span>
                          </div>
                        )}

                        {proximoRetorno && (
                          <div
                            title={`${proximoRetorno.titulo} · ${proximoRetorno.quando}`}
                            className={cn(
                              'mt-2 flex items-start gap-1.5 text-xs',
                              proximoRetorno.atrasado ? 'text-red-600' : 'text-neutral-600',
                            )}
                          >
                            <CalendarClock className="mt-px size-3.5 shrink-0" />
                            <span className="line-clamp-2">
                              {/* "Atrasado" depende da hora atual — mesma
                                  divergência de hidratação do "há 3 h". */}
                              <span className="font-medium" suppressHydrationWarning>
                                {proximoRetorno.atrasado
                                  ? `Atrasado desde ${proximoRetorno.quando}`
                                  : `Retorno ${proximoRetorno.quando}`}
                              </span>{' '}
                              · {proximoRetorno.titulo}
                            </span>
                          </div>
                        )}

                        {/* flex-wrap: em tela apertada os botões descem de
                            linha (e o ml-auto os mantém à direita) em vez de
                            serem empurrados pra fora do cartão. */}
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                          <Badge
                            variant="secondary"
                            title={labelOrigem(lead.origem)}
                            className="max-w-full min-w-0 shrink justify-start text-xs"
                          >
                            <span className="truncate">{labelOrigem(lead.origem)}</span>
                          </Badge>
                          <div className="ml-auto flex items-center gap-1">
                            {/*
                            wa.me abre a conversa no WhatsApp do próprio broker,
                            como pessoa. Não depende de verificação da Meta,
                            nem de template, nem de número oficial.
                          */}
                            {lead.telefone && (
                              <a
                                href={linkZap!}
                                target="_blank"
                                rel="noopener noreferrer"
                                draggable={false}
                                onClick={(e) => e.stopPropagation()}
                                title={
                                  modelo
                                    ? 'Abrir WhatsApp com a mensagem pronta'
                                    : 'Abrir conversa no WhatsApp'
                                }
                                className="rounded-md p-1.5 text-[#25D366] transition-colors hover:bg-[#25D366]/10 hover:text-[#128C7E]"
                              >
                                <IconeWhatsApp className="size-[18px]" />
                              </a>
                            )}
                            {/* Envia pelo número da RGT, com modelo aprovado. */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLeadDisparo({ id: lead.id, nome: lead.nome });
                              }}
                              title="Abordar pelo WhatsApp da RGT"
                              className="rounded-md p-1.5 text-emerald-700 transition-colors hover:bg-emerald-50"
                            >
                              <Send className="size-4" />
                            </button>
                            {/* CalendarPlus, não o mesmo relógio da linha de
                                retorno: eram dois ícones iguais com funções
                                diferentes. */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLeadRetorno({ id: lead.id, nome: lead.nome });
                              }}
                              title="Agendar retorno"
                              className="rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
                            >
                              <CalendarPlus className="size-4" />
                            </button>
                            {lead.dono?.nome && (
                              <span
                                title={`Responsável: ${lead.dono.nome}`}
                                className="ml-0.5 flex size-6 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-medium text-white"
                              >
                                {iniciais(lead.dono.nome)}
                              </span>
                            )}
                          </div>
                        </div>
                        {(lead.status === 'qualificado' || lead.status === 'proposta_enviada') && (
                          <a
                            href={`/operacoes/nova?lead_id=${lead.id}`}
                            draggable={false}
                            onClick={(e) => e.stopPropagation()}
                            className={cn(
                              buttonVariants({ size: 'sm' }),
                              'mt-3 w-full bg-emerald-600 text-white hover:bg-emerald-700',
                            )}
                          >
                            Virar operação
                            <ArrowRight className="size-3.5" />
                          </a>
                        )}
                        {lead.status === 'perdido' && lead.motivo_perda && (
                          <p className="mt-2 border-l-2 border-red-300 pl-2 text-xs text-neutral-600 italic">
                            {lead.motivo_perda}
                          </p>
                        )}
                        {lead.status === 'ganho' && lead.operacao_id && (
                          <a
                            href={`/operacoes/${lead.operacao_id}`}
                            draggable={false}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-2 inline-block text-xs text-emerald-700 underline"
                          >
                            → Ver operação
                          </a>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      <LeadForm
        aberto={abrirNovo}
        onClose={onNovoFechado}
        donos={donos}
        meuId={meuId}
        isAdmin={isAdmin}
      />

      {editandoLead && (
        <LeadForm
          aberto={true}
          onClose={() => setEditandoLead(null)}
          donos={donos}
          meuId={meuId}
          isAdmin={isAdmin}
          editando={editandoLead}
        />
      )}

      <Dialog open={!!modalPerdido} onOpenChange={(open) => !open && setModalPerdido(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como perdido</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-neutral-600">
            Lead: <strong className="text-neutral-900">{modalPerdido?.nome}</strong>
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="motivo-perda">Motivo *</Label>
            <Textarea
              id="motivo-perda"
              value={motivoPerda}
              onChange={(e) => setMotivoPerda(e.target.value)}
              rows={3}
              placeholder="Ex: cliente desistiu, valor abaixo do mínimo, fora do ICP"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setModalPerdido(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmarPerda}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Confirmar perda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DialogRetorno lead={leadRetorno} onFechar={() => setLeadRetorno(null)} />
      <DialogDisparo lead={leadDisparo} onFechar={() => setLeadDisparo(null)} />
    </div>
  );
}
