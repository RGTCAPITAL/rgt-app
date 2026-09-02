'use client';

import { useState } from 'react';
import { labelEtapa } from '@/lib/workflow';
import { fmtDataBR } from '@/lib/formatters';
import { TabComentarios, type Comentario } from './tab-comentarios';
import { TabDocumentos, type Documento } from './tab-documentos';
import { TabTarefas, type Tarefa, type UsuarioOpt } from './tab-tarefas';
import type { ContextoCedente } from '@/lib/documentos-checklist';

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

type TabKey = (typeof TABS)[number]['key'];

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
  const [tab, setTab] = useState<TabKey>('detalhes');

  return (
    <div className="rounded-md border border-neutral-200 bg-white">
      <div className="flex border-b border-neutral-200">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`border-b-2 px-4 py-3 text-sm ${
                active
                  ? 'border-neutral-900 font-medium text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:text-neutral-900'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="p-6">
        {tab === 'detalhes' && <TabDetalhes op={operacao} />}
        {tab === 'documentos' && (
          <TabDocumentos
            operacaoId={operacaoId}
            tipoAtivo={tipoAtivo}
            ctxCedente={ctxCedente}
            usuarioAtualId={usuarioAtualId}
            isAdmin={isAdmin}
            documentos={documentos}
          />
        )}
        {tab === 'tarefas' && (
          <TabTarefas
            operacaoId={operacaoId}
            tarefas={tarefas}
            usuarios={usuariosOpt}
            meuId={usuarioAtualId}
          />
        )}
        {tab === 'comentarios' && (
          <TabComentarios
            operacaoId={operacaoId}
            usuarioAtualId={usuarioAtualId}
            isAdmin={isAdmin}
            comentarios={comentarios}
          />
        )}
        {tab === 'historico' && <TabHistorico historico={historico} />}
      </div>
    </div>
  );
}

function TabDetalhes({ op }: { op: OperacaoDetalhes }) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-neutral-900">Valores</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Item label="Valor total" value={fmtBRL(op.valor_total)} />
          <Item label="Valor principal" value={fmtBRL(op.valor_principal)} />
          <Item label="Valor dos juros" value={fmtBRL(op.valor_juros)} />
          <Item label="Valor SELIC" value={fmtBRL(op.valor_selic)} />
          <Item
            label="Preço proposto"
            value={
              op.preco_proposto
                ? `${fmtBRL(op.preco_proposto)}${
                    op.preco_aceito === true
                      ? ' · aceito'
                      : op.preco_aceito === false
                        ? ' · recusado'
                        : ' · pendente'
                  }`
                : '—'
            }
          />
        </dl>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-neutral-900">Deduções</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Item label="Retenção de honorários" value={fmtPct(op.retencao_honorarios_pct)} />
          <Item label="Percentual de aquisição" value={fmtPct(op.percentual_aquisicao)} />
          <Item
            label="PSS"
            value={op.pss_ativo ? `Ativo — ${fmtPct(op.pss_pct)}` : 'Não aplica'}
          />
          <Item
            label="IR / RRA"
            value={
              op.rra_ativo
                ? op.rra_meses === 0
                  ? 'Ativo — IR fixo 3%'
                  : `Ativo — ${op.rra_meses} meses acumulados`
                : 'Não aplica'
            }
          />
        </dl>
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
          <p className="whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-sm text-neutral-700">
            {op.observacoes}
          </p>
        </section>
      )}
    </div>
  );
}

function TabHistorico({ historico }: { historico: EtapaHistorico[] }) {
  if (historico.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhum histórico registrado ainda.</p>;
  }
  return (
    <ol className="space-y-4">
      {historico.map((h) => {
        const atual = h.saiu_em === null;
        return (
          <li key={h.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={`h-3 w-3 rounded-full ${
                  atual ? 'bg-neutral-900 ring-4 ring-neutral-900/10' : 'bg-emerald-600'
                }`}
              />
              <div className="mt-1 h-full w-px bg-neutral-200" />
            </div>
            <div className="flex-1 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-neutral-900">
                  {labelEtapa(h.etapa)}
                </span>
                {atual && (
                  <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                    Atual
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-neutral-500">
                Entrou em {fmtDataHora(h.entrou_em)}
                {h.autorizado_por?.nome && ` · por ${h.autorizado_por.nome}`}
                {' · '}
                {atual ? `há ${diffDuracao(h.entrou_em, null)}` : `permaneceu ${diffDuracao(h.entrou_em, h.saiu_em)}`}
              </p>
              {h.observacao && (
                <p className="mt-1 text-sm text-neutral-700">{h.observacao}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PlaceholderTab({ issue, descricao }: { issue: string; descricao: string }) {
  return (
    <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
      <p className="text-sm text-neutral-600">
        Implementação de <strong>{descricao}</strong> pendente na issue <strong>{issue}</strong>.
      </p>
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
