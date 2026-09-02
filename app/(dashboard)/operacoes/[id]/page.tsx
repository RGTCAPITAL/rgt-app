import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { WorkflowStepper } from './workflow-stepper';
import { DetalheTabs } from './detalhe-tabs';
import { AcoesEtapa } from './acoes-etapa';
import { ToastNovaOperacao } from './toast-auto-hide';
import { labelEtapa } from '@/lib/workflow';
import { TIPOS_ATIVO, ESPECIES } from '../nova/schemas';
import { fmtDataBR } from '@/lib/formatters';

type Operacao = {
  id: string;
  numero_processo: string;
  tipo: string;
  esfera: string;
  natureza: string;
  especie: string;
  tribunal: string;
  valor_total: number;
  valor_principal: number | null;
  valor_juros: number | null;
  valor_selic: number | null;
  retencao_honorarios_pct: number;
  percentual_aquisicao: number;
  pss_ativo: boolean;
  pss_pct: number | null;
  rra_ativo: boolean;
  rra_meses: number | null;
  data_base: string;
  data_autuacao: string | null;
  loa: number | null;
  cedente_nome: string;
  cedente_cpf: string;
  cedente_data_nascimento: string | null;
  cedente_estado_civil: string | null;
  observacoes: string | null;
  preco_aceito: boolean | null;
  preco_proposto: number | null;
  etapa_atual: string;
  created_at: string;
  updated_at: string;
  dono: { nome: string | null } | null;
  broker: { nome: string | null } | null;
  ente_devedor: { nome: string } | null;
};

type EtapaHist = {
  id: string;
  etapa: string;
  entrou_em: string;
  saiu_em: string | null;
  observacao: string | null;
  autorizado_por: { nome: string | null } | null;
};

function fmtBRL(v: number): string {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtCPF(cpf: string): string {
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function labelTipo(v: string): string {
  return TIPOS_ATIVO.find((t) => t.value === v)?.label ?? v;
}

function corEtapa(etapa: string): string {
  if (etapa === 'finalizada') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (etapa === 'cancelada') return 'bg-red-100 text-red-800 border-red-200';
  if (etapa === 'pagamento') return 'bg-blue-100 text-blue-800 border-blue-200';
  return 'bg-neutral-100 text-neutral-800 border-neutral-200';
}

export default async function OperacaoDetalhePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nova?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: op, error } = await supabase
    .from('operacoes')
    .select(
      `id, numero_processo, tipo, esfera, natureza, especie, tribunal,
       valor_total, valor_principal, valor_juros, valor_selic,
       retencao_honorarios_pct, percentual_aquisicao,
       pss_ativo, pss_pct, rra_ativo, rra_meses,
       data_base, data_autuacao, loa,
       cedente_nome, cedente_cpf, cedente_data_nascimento, cedente_estado_civil,
       observacoes, preco_aceito, preco_proposto,
       etapa_atual, created_at, updated_at,
       dono:usuarios!operacoes_dono_id_fkey(nome),
       broker:usuarios!operacoes_broker_id_fkey(nome),
       ente_devedor:entes_devedores(nome)`,
    )
    .eq('id', id)
    .single<Operacao>();

  if (error || !op) notFound();

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();

  const role = usuario?.perfil?.slug ?? '';
  const podeAvancar = ['admin', 'gestao'].includes(role);
  const isAdmin = role === 'admin';

  const { data: historico } = await supabase
    .from('etapas_operacao')
    .select('id, etapa, entrou_em, saiu_em, observacao, autorizado_por:usuarios(nome)')
    .eq('operacao_id', id)
    .order('entrou_em', { ascending: false })
    .returns<EtapaHist[]>();

  const { data: comentarios } = await supabase
    .from('comentarios')
    .select('id, texto, etapa, created_at, autor:usuarios(id, nome)')
    .eq('operacao_id', id)
    .order('created_at', { ascending: false })
    .returns<
      { id: string; texto: string; etapa: string | null; created_at: string; autor: { id: string; nome: string | null } | null }[]
    >();

  const { data: documentos } = await supabase
    .from('documentos')
    .select('id, tipo, nome_original, storage_path, tamanho_bytes, uploaded_at, uploaded_by, uploader:usuarios!documentos_uploaded_by_fkey(nome)')
    .eq('operacao_id', id)
    .order('uploaded_at', { ascending: false })
    .returns<
      { id: string; tipo: string; nome_original: string; storage_path: string; tamanho_bytes: number | null; uploaded_at: string; uploaded_by: string | null; uploader: { nome: string | null } | null }[]
    >();

  const { data: tarefas } = await supabase
    .from('tarefas')
    .select(
      'id, titulo, descricao, destinatario_perfil, destinatario_id, prazo, status, created_at, criado_por:usuarios!tarefas_criado_por_id_fkey(nome), destinatario:usuarios!tarefas_destinatario_id_fkey(nome)',
    )
    .eq('operacao_id', id)
    .order('created_at', { ascending: false })
    .returns<
      { id: string; titulo: string; descricao: string | null; destinatario_perfil: string | null; destinatario_id: string | null; prazo: string | null; status: string; created_at: string; criado_por: { nome: string | null } | null; destinatario: { nome: string | null } | null }[]
    >();

  const { data: usuariosOpt } = await supabase
    .from('usuarios')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome')
    .returns<{ id: string; nome: string | null }[]>();

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4">
        <Link href="/operacoes" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Operações
        </Link>
      </div>

      {sp.nova === '1' && <ToastNovaOperacao />}

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            {op.numero_processo}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            {op.cedente_nome} · {labelTipo(op.tipo)} · {op.tribunal}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Valor total</div>
            <div className="text-lg font-semibold text-neutral-900">{fmtBRL(op.valor_total)}</div>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${corEtapa(op.etapa_atual)}`}
          >
            {labelEtapa(op.etapa_atual)}
          </span>
        </div>
      </header>

      <div className="mb-6">
        <WorkflowStepper etapaAtual={op.etapa_atual} />
      </div>

      <div className="mb-6">
        <AcoesEtapa
          operacaoId={op.id}
          etapaAtual={op.etapa_atual}
          podeAvancar={podeAvancar}
          precoAceito={op.preco_aceito}
          precoProposto={op.preco_proposto}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <DetalheTabs
            operacaoId={op.id}
            tipoAtivo={op.tipo}
            ctxCedente={{
              dataNascimento: op.cedente_data_nascimento,
              estadoCivil: op.cedente_estado_civil,
            }}
            usuarioAtualId={user.id}
            isAdmin={isAdmin}
            comentarios={comentarios ?? []}
            documentos={documentos ?? []}
            tarefas={tarefas ?? []}
            usuariosOpt={usuariosOpt ?? []}
            operacao={{
              valor_total: op.valor_total,
              valor_principal: op.valor_principal,
              valor_juros: op.valor_juros,
              valor_selic: op.valor_selic,
              preco_proposto: op.preco_proposto,
              preco_aceito: op.preco_aceito,
              retencao_honorarios_pct: op.retencao_honorarios_pct,
              percentual_aquisicao: op.percentual_aquisicao,
              pss_ativo: op.pss_ativo,
              pss_pct: op.pss_pct,
              rra_ativo: op.rra_ativo,
              rra_meses: op.rra_meses,
              data_base: op.data_base,
              data_autuacao: op.data_autuacao,
              loa: op.loa,
              observacoes: op.observacoes,
            }}
            historico={historico ?? []}
          />
        </div>

        <aside className="space-y-4">
          <SideCard title="Identificação">
            <SideItem label="Tipo" value={labelTipo(op.tipo)} />
            <SideItem label="Esfera" value={<span className="capitalize">{op.esfera}</span>} />
            <SideItem label="Natureza" value={<span className="capitalize">{op.natureza}</span>} />
            <SideItem label="Espécie" value={ESPECIES.find((e) => e.value === op.especie)?.label ?? op.especie} />
          </SideCard>

          <SideCard title="Cedente">
            <SideItem label="Nome" value={op.cedente_nome} />
            <SideItem label="CPF" value={fmtCPF(op.cedente_cpf)} />
          </SideCard>

          <SideCard title="Devedor & tribunal">
            <SideItem label="Ente" value={op.ente_devedor?.nome ?? '—'} />
            <SideItem label="Tribunal" value={op.tribunal} />
          </SideCard>

          <SideCard title="Responsáveis">
            <SideItem label="Dono" value={op.dono?.nome ?? '—'} />
            {op.broker?.nome && op.broker.nome !== op.dono?.nome && (
              <SideItem label="Broker" value={op.broker.nome} />
            )}
          </SideCard>

          <SideCard title="Sistema">
            <SideItem label="Criada em" value={fmtDataBR(op.created_at)} />
            <SideItem label="Atualizada" value={fmtDataBR(op.updated_at)} />
          </SideCard>

        </aside>
      </div>
    </div>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h3>
      <dl className="space-y-2 text-sm">{children}</dl>
    </div>
  );
}

function SideItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="font-medium text-neutral-900">{value}</dd>
    </div>
  );
}
