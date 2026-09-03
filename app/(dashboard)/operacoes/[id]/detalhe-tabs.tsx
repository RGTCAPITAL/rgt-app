'use client';

import { labelEtapa } from '@/lib/workflow';
import { fmtDataBR } from '@/lib/formatters';
import { TabComentarios, type Comentario } from './tab-comentarios';
import { TabDocumentos, type Documento } from './tab-documentos';
import { TabTarefas, type Tarefa, type UsuarioOpt } from './tab-tarefas';
import type { ContextoCedente } from '@/lib/documentos-checklist';
import { cn } from '@/lib/utils';
import { Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function fmtRelativoBR(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora mesmo';
  if (mins < 60) return `há ${mins} min`;
  const horas = Math.floor(mins / 60);
  if (horas < 24) return `há cerca de ${horas} hora${horas > 1 ? 's' : ''}`;
  const dias = Math.floor(horas / 24);
  if (dias < 30) return `há ${dias} dia${dias > 1 ? 's' : ''}`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

type EtapaHistorico = {
  id: string;
  etapa: string;
  entrou_em: string;
  saiu_em: string | null;
  observacao: string | null;
  autorizado_por: { nome: string | null } | null;
};

type OperacaoDetalhes = {
  valor_total: number;
  valor_principal: number | null;
  valor_juros: number | null;
  valor_selic: number | null;
  preco_proposto: number | null;
  preco_aceito: boolean | null;
  retencao_honorarios_pct: number;
  percentual_aquisicao: number;
  pss_ativo: boolean;
  pss_pct: number | null;
  rra_ativo: boolean;
  rra_meses: number | null;
  data_base: string;
  data_autuacao: string | null;
  loa: number | null;
  observacoes: string | null;
};

type Props = {
  operacaoId: string;
  tipoAtivo: string;
  ctxCedente?: ContextoCedente;
  operacao: OperacaoDetalhes;
  historico: EtapaHistorico[];
  comentarios: Comentario[];
  documentos: Documento[];
  tarefas: Tarefa[];
  usuariosOpt: UsuarioOpt[];
  usuarioAtualId: string;
  isAdmin: boolean;
};

const TABS = [
  { key: 'detalhes', label: 'Detalhes' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'tarefas', label: 'Tarefas' },
  { key: 'comentarios', label: 'Comentários' },
  { key: 'historico', label: 'Histórico' },
] as const;

function fmtBRL(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

function fmtData(iso: string | null): string {
  return fmtDataBR(iso);
}

function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

function diffDuracao(inicio: string, fim: string | null): string {
  const start = new Date(inicio).getTime();
  const end = fim ? new Date(fim).getTime() : Date.now();
  const dias = Math.floor((end - start) / (1000 * 60 * 60 * 24));
  if (dias === 0) return 'menos de 1 dia';
  if (dias === 1) return '1 dia';
  return `${dias} dias`;
}

export function DetalheTabs({
  operacaoId,
  tipoAtivo,
  ctxCedente,
  operacao,
  historico,
  comentarios,
  documentos,
  tarefas,
  usuariosOpt,
  usuarioAtualId,
  isAdmin,
}: Props) {
  return (
    <Card className="p-0">
      <Tabs defaultValue="detalhes" className="gap-0">
        <TabsList variant="line" className="border-b border-neutral-200 px-4 pt-2">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="detalhes" className="p-6">
          <TabDetalhes op={operacao} />
        </TabsContent>
        <TabsContent value="documentos" className="p-6">
          <TabDocumentos
            operacaoId={operacaoId}
            tipoAtivo={tipoAtivo}
            ctxCedente={ctxCedente}
            usuarioAtualId={usuarioAtualId}
            isAdmin={isAdmin}
            documentos={documentos}
          />
        </TabsContent>
        <TabsContent value="tarefas" className="p-6">
          <TabTarefas
            operacaoId={operacaoId}
            tarefas={tarefas}
            usuarios={usuariosOpt}
            meuId={usuarioAtualId}
          />
        </TabsContent>
        <TabsContent value="comentarios" className="p-6">
          <TabComentarios
            operacaoId={operacaoId}
            usuarioAtualId={usuarioAtualId}
            isAdmin={isAdmin}
            comentarios={comentarios}
          />
        </TabsContent>
        <TabsContent value="historico" className="p-6">
          <TabHistorico historico={historico} />
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function TabDetalhes({ op }: { op: OperacaoDetalhes }) {
  const totalPct = (v: number | null | undefined) =>
    op.valor_total > 0 && v ? `${((v / op.valor_total) * 100).toFixed(2)}% do total` : '—';
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-neutral-900">Valores do crédito</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FinanceTile
            label="Valor Principal"
            value={fmtBRL(op.valor_principal)}
            sub={totalPct(op.valor_principal)}
          />
          <FinanceTile
            label="Valor dos Juros"
            value={fmtBRL(op.valor_juros)}
            sub={totalPct(op.valor_juros)}
          />
          <FinanceTile
            label="Valor SELIC"
            value={fmtBRL(op.valor_selic)}
            sub={totalPct(op.valor_selic)}
          />
          <FinanceTile
            label="Valor Total do Crédito"
            value={fmtBRL(op.valor_total)}
            sub="100% do crédito"
            color="emerald"
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-neutral-900">Deduções e líquido</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FinanceTile
            label="Retenção Honorários"
            value={fmtPct(op.retencao_honorarios_pct)}
            color="rose"
          />
          <FinanceTile
            label="RRA / IR"
            value={
              op.rra_ativo ? (op.rra_meses === 0 ? 'IR fixo 3%' : `${op.rra_meses} meses`) : '—'
            }
            color="rose"
          />
          <FinanceTile label="PSS" value={op.pss_ativo ? fmtPct(op.pss_pct) : '—'} color="rose" />
          <FinanceTile
            label="Preço Proposto"
            value={op.preco_proposto ? fmtBRL(op.preco_proposto) : '—'}
            sub={
              op.preco_proposto
                ? op.preco_aceito === true
                  ? 'aceito pelo credor'
                  : op.preco_aceito === false
                    ? 'recusado pelo credor'
                    : 'aguardando resposta'
                : undefined
            }
            color="blue"
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-neutral-900">Datas</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Item label="Data-base do cálculo" value={fmtData(op.data_base)} />
          <Item label="Data de autuação" value={fmtData(op.data_autuacao)} />
          <Item label="LOA estimada" value={op.loa ? String(op.loa) : '—'} />
        </dl>
      </section>

      {op.observacoes && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-neutral-900">Observações</h3>
          <p className="rounded-md bg-neutral-50 p-3 text-sm whitespace-pre-wrap text-neutral-700">
            {op.observacoes}
          </p>
        </section>
      )}
    </div>
  );
}

function FinanceTile({
  label,
  value,
  sub,
  color = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  color?: 'emerald' | 'rose' | 'blue' | 'amber' | 'neutral';
}) {
  const bg: Record<string, string> = {
    emerald: 'bg-emerald-50 ring-emerald-200',
    rose: 'bg-rose-50 ring-rose-200',
    blue: 'bg-blue-50 ring-blue-200',
    amber: 'bg-amber-50 ring-amber-200',
    neutral: 'bg-neutral-50 ring-neutral-200',
  };
  const valueColor: Record<string, string> = {
    emerald: 'text-emerald-700',
    rose: 'text-rose-700',
    blue: 'text-blue-700',
    amber: 'text-amber-700',
    neutral: 'text-neutral-900',
  };
  return (
    <div className={`rounded-lg px-3 py-3 ring-1 ${bg[color]}`}>
      <div className="text-xs font-medium text-neutral-600">{label}</div>
      <div className={`mt-1 text-lg font-bold ${valueColor[color]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-neutral-500">{sub}</div>}
    </div>
  );
}

function TabHistorico({ historico }: { historico: EtapaHistorico[] }) {
  if (historico.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-sm text-neutral-500">
        Nenhum evento registrado ainda.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {historico.map((h, i) => {
        const atual = h.saiu_em === null;
        const anterior = historico[i + 1];
        return (
          <div
            key={h.id}
            className="flex gap-3 rounded-lg border border-neutral-100 bg-white p-4 transition-colors hover:bg-neutral-50/60"
          >
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full',
                atual ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700',
              )}
            >
              <Info className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500">
                <span className="font-medium text-neutral-900">
                  {h.autorizado_por?.nome ?? 'Sistema'}
                </span>
                <span>·</span>
                <span>{fmtRelativoBR(h.entrou_em)}</span>
                <span>·</span>
                <span>{fmtDataHora(h.entrou_em)}</span>
                {atual && (
                  <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                    em andamento
                  </span>
                )}
              </div>
              <div className="mt-1 text-sm text-neutral-900">
                Status alterado para{' '}
                <strong className="font-semibold">{labelEtapa(h.etapa)}</strong>
              </div>
              <div className="mt-0.5 text-xs text-neutral-600">
                {anterior
                  ? `Status alterado de "${labelEtapa(anterior.etapa)}" para "${labelEtapa(h.etapa)}"`
                  : 'Operação criada com status ' + labelEtapa(h.etapa)}
                {!atual && ` · permaneceu ${diffDuracao(h.entrou_em, h.saiu_em)}`}
              </div>
              {h.observacao && (
                <p className="mt-2 rounded-md bg-neutral-50 p-2 text-xs whitespace-pre-wrap text-neutral-700">
                  {h.observacao}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium text-neutral-900">{value}</dd>
    </>
  );
}
