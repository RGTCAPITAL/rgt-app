import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Briefcase,
  TrendingUp,
  Wallet,
  Users,
  AlertTriangle,
  CircleDollarSign,
  Sparkles,
  Plus,
  Inbox,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { labelEtapa } from '@/lib/workflow';
import { TIPOS_ATIVO } from './operacoes/nova/schemas';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { SectionHero, KpiTile } from '@/components/ui/section-hero';
import { cn } from '@/lib/utils';

type UsuarioComPerfil = {
  nome: string | null;
  perfis: { slug: string; nome: string } | null;
};

type OpResumo = {
  id: string;
  numero_processo: string;
  cedente_nome: string;
  tipo: string;
  etapa_atual: string;
  valor_total: number;
  preco_aceito: boolean | null;
  updated_at: string;
  dono: { nome: string | null } | null;
};

function fmtBRL(v: number): string {
  return Number(v).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}
function fmtRel(iso: string): string {
  const d = new Date(iso);
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias}d`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function classesEtapa(etapa: string): string {
  if (etapa === 'finalizada')
    return 'border-transparent bg-emerald-100 text-emerald-800 hover:bg-emerald-100';
  if (etapa === 'cancelada') return 'border-transparent bg-red-100 text-red-800 hover:bg-red-100';
  if (etapa === 'pagamento')
    return 'border-transparent bg-blue-100 text-blue-800 hover:bg-blue-100';
  return 'border-transparent bg-neutral-100 text-neutral-700 hover:bg-neutral-100';
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('nome, perfis(slug, nome)')
    .eq('id', user.id)
    .single<UsuarioComPerfil>();

  const perfil = usuario?.perfis?.slug ?? null;
  const primeiroNome = (usuario?.nome ?? '').split(' ')[0] || null;

  if (!perfil) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight">Bem-vindo</h1>
        <div className="mt-6 flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <AlertTriangle className="size-5 shrink-0" />
          <div>
            <h3 className="font-semibold">Aguardando definição de perfil</h3>
            <p className="mt-2">
              Sua conta foi criada mas ainda não tem perfil. Peça pro admin te promover em{' '}
              <code>/admin/usuarios</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ===== JURÍDICO =====
  if (perfil === 'juridico') {
    const { data: ddJuridica } = await supabase
      .from('operacoes')
      .select(
        'id, numero_processo, cedente_nome, tipo, etapa_atual, valor_total, preco_aceito, updated_at, dono:usuarios!operacoes_dono_id_fkey(nome)',
      )
      .eq('etapa_atual', 'due_diligence_juridica')
      .order('updated_at', { ascending: true })
      .limit(20)
      .returns<OpResumo[]>();

    const { count: totalDD } = await supabase
      .from('operacoes')
      .select('id', { count: 'exact', head: true })
      .eq('etapa_atual', 'due_diligence_juridica');

    return (
      <div>
        <Header primeiroNome={primeiroNome} perfilLabel={usuario?.perfis?.nome ?? 'Jurídico'} />
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Kpi
            label="Em DD Jurídica"
            valor={String(totalDD ?? 0)}
            sub="aguardando seu parecer"
            icon={Briefcase}
          />
          <Kpi
            label="Valor total em análise"
            valor={fmtBRL((ddJuridica ?? []).reduce((a, o) => a + Number(o.valor_total || 0), 0))}
            sub={`${ddJuridica?.length ?? 0} operações listadas abaixo`}
            icon={CircleDollarSign}
          />
        </div>
        <SectionOps
          titulo="Sua fila de due diligence"
          icon={Briefcase}
          ops={ddJuridica ?? []}
          vazio="Nenhuma operação aguardando parecer jurídico agora."
        />
      </div>
    );
  }

  // ===== BROKER =====
  if (perfil === 'broker') {
    const { data: minhas } = await supabase
      .from('operacoes')
      .select(
        'id, numero_processo, cedente_nome, tipo, etapa_atual, valor_total, preco_aceito, updated_at, dono:usuarios!operacoes_dono_id_fkey(nome)',
      )
      .order('updated_at', { ascending: false })
      .limit(10)
      .returns<OpResumo[]>();

    const emAndamento = (minhas ?? []).filter(
      (o) => o.etapa_atual !== 'finalizada' && o.etapa_atual !== 'cancelada',
    );
    const valorTotalPipeline = emAndamento.reduce((a, o) => a + Number(o.valor_total || 0), 0);
    const finalizadas = (minhas ?? []).filter((o) => o.etapa_atual === 'finalizada').length;

    return (
      <div>
        <Header primeiroNome={primeiroNome} perfilLabel="Broker" cta />
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi
            label="Em andamento"
            valor={String(emAndamento.length)}
            sub="operações suas ativas"
            icon={Briefcase}
          />
          <Kpi
            label="Pipeline"
            valor={fmtBRL(valorTotalPipeline)}
            sub="valor total em andamento"
            icon={TrendingUp}
          />
          <Kpi
            label="Finalizadas (recentes)"
            valor={String(finalizadas)}
            sub="nas últimas 10"
            icon={CircleDollarSign}
          />
        </div>
        <SectionOps
          titulo="Suas operações recentes"
          icon={Sparkles}
          ops={(minhas ?? []).slice(0, 5)}
          vazio="Você ainda não cadastrou nenhuma operação. Comece pelo botão acima."
        />
      </div>
    );
  }

  // ===== ADMIN / GESTÃO =====
  const seteDiasAtras = new Date(Date.now() - 7 * 86400000).toISOString();
  const quatorzeDiasAtras = new Date(Date.now() - 14 * 86400000).toISOString();

  const [abertas, aceitePendente, prontasPagamento, ddTravada, ultimasCriadas, leadsAbertos] =
    await Promise.all([
      supabase
        .from('operacoes')
        .select('id, valor_total', { count: 'exact' })
        .not('etapa_atual', 'in', '(finalizada,cancelada)')
        .returns<{ id: string; valor_total: number }[]>(),
      supabase
        .from('operacoes')
        .select(
          'id, numero_processo, cedente_nome, tipo, etapa_atual, valor_total, preco_aceito, updated_at, dono:usuarios!operacoes_dono_id_fkey(nome)',
        )
        .eq('etapa_atual', 'aceite')
        .lt('updated_at', seteDiasAtras)
        .order('updated_at', { ascending: true })
        .returns<OpResumo[]>(),
      supabase
        .from('operacoes')
        .select(
          'id, numero_processo, cedente_nome, tipo, etapa_atual, valor_total, preco_aceito, updated_at, dono:usuarios!operacoes_dono_id_fkey(nome)',
        )
        .eq('etapa_atual', 'pagamento')
        .order('updated_at', { ascending: true })
        .returns<OpResumo[]>(),
      supabase
        .from('operacoes')
        .select(
          'id, numero_processo, cedente_nome, tipo, etapa_atual, valor_total, preco_aceito, updated_at, dono:usuarios!operacoes_dono_id_fkey(nome)',
        )
        .in('etapa_atual', ['due_diligence_juridica', 'due_diligence_fiscal'])
        .lt('updated_at', quatorzeDiasAtras)
        .order('updated_at', { ascending: true })
        .returns<OpResumo[]>(),
      supabase
        .from('operacoes')
        .select(
          'id, numero_processo, cedente_nome, tipo, etapa_atual, valor_total, preco_aceito, updated_at, dono:usuarios!operacoes_dono_id_fkey(nome)',
        )
        .order('created_at', { ascending: false })
        .limit(5)
        .returns<OpResumo[]>(),
      supabase
        .from('leads')
        .select('id, status', { count: 'exact', head: true })
        .not('status', 'in', '(ganho,perdido)'),
    ]);

  const totalAbertas = abertas.count ?? 0;
  const totalPipeline = (abertas.data ?? []).reduce((a, o) => a + Number(o.valor_total || 0), 0);
  const aceitesAntigos = aceitePendente.data ?? [];
  const prontas = prontasPagamento.data ?? [];
  const ddTravadas = ddTravada.data ?? [];
  const recentes = ultimasCriadas.data ?? [];
  const totalLeadsAbertos = leadsAbertos.count ?? 0;

  const filaAtencao = [...aceitesAntigos, ...ddTravadas].sort((a, b) =>
    a.updated_at.localeCompare(b.updated_at),
  );

  return (
    <div>
      <SectionHero
        title={primeiroNome ? `Olá, ${primeiroNome}` : 'Bem-vindo'}
        subtitle={`Painel ${usuario?.perfis?.nome ?? 'Admin/Gestão'} · Panorama do que precisa da sua atenção agora.`}
        color="emerald"
        action={
          <Link
            href="/operacoes/nova"
            className="inline-flex items-center gap-2 rounded-lg bg-white/95 px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm transition-colors hover:bg-white"
          >
            <Plus className="size-4" />
            Nova operação
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Operações abertas"
          value={String(totalAbertas)}
          sub="fora de finalizada/cancelada"
          icon={Briefcase}
          color="blue"
        />
        <KpiTile
          label="Pipeline"
          value={fmtBRL(totalPipeline)}
          sub="valor total em andamento"
          icon={TrendingUp}
          color="emerald"
        />
        <KpiTile
          label="Prontas pra pagar"
          value={String(prontas.length)}
          sub={prontas.length === 1 ? '1 operação' : `${prontas.length} operações`}
          icon={Wallet}
          color="amber"
        />
        <KpiTile
          label="Leads em aberto"
          value={String(totalLeadsAbertos)}
          sub="pipeline CRM"
          icon={Users}
          color="violet"
          href="/crm"
        />
      </div>

      {filaAtencao.length > 0 && (
        <SectionOps
          titulo="Precisa de atenção"
          icon={AlertTriangle}
          descricao="Aceite pendente há mais de 7 dias · DD travada há mais de 14 dias"
          ops={filaAtencao}
          vazio=""
          color="amber"
        />
      )}

      {prontas.length > 0 && (
        <SectionOps
          titulo="Prontas pra pagamento"
          icon={Wallet}
          ops={prontas}
          vazio=""
          color="emerald"
        />
      )}

      <SectionOps
        titulo="Últimas cadastradas"
        icon={Sparkles}
        ops={recentes}
        vazio="Nenhuma operação cadastrada ainda."
        color="blue"
      />
    </div>
  );
}

// ───────── UI ─────────

function Header({
  primeiroNome,
  perfilLabel,
  cta,
}: {
  primeiroNome: string | null;
  perfilLabel: string;
  cta?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-900">
          {primeiroNome ? `Olá, ${primeiroNome}` : 'Bem-vindo'}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Painel <strong>{perfilLabel}</strong>. Panorama do que precisa da sua atenção agora.
        </p>
      </div>
      {cta && (
        <Link href="/operacoes/nova" className={cn(buttonVariants({ size: 'lg' }))}>
          <Plus className="size-4" />
          Nova operação
        </Link>
      )}
    </div>
  );
}

type LucideIcon = React.ComponentType<{ className?: string }>;

function Kpi({
  label,
  valor,
  sub,
  icon: Icon,
  linkPara,
}: {
  label: string;
  valor: string;
  sub?: string;
  icon: LucideIcon;
  linkPara?: string;
}) {
  const inner = (
    <Card size="sm" className="transition-shadow hover:shadow-md">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
            {label}
          </CardTitle>
          <Icon className="size-4 text-neutral-400" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold text-neutral-900">{valor}</div>
        {sub && <div className="mt-0.5 text-xs text-neutral-500">{sub}</div>}
      </CardContent>
    </Card>
  );
  return linkPara ? (
    <Link href={linkPara} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function SectionOps({
  titulo,
  descricao,
  ops,
  vazio,
  icon: Icon,
  color = 'neutral',
}: {
  titulo: string;
  descricao?: string;
  ops: OpResumo[];
  vazio: string;
  icon: LucideIcon;
  color?: 'emerald' | 'amber' | 'blue' | 'violet' | 'neutral';
}) {
  const headerBg: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-800',
    blue: 'bg-blue-50 text-blue-700',
    violet: 'bg-violet-50 text-violet-700',
    neutral: 'bg-neutral-50 text-neutral-700',
  };
  const borderColor: Record<string, string> = {
    emerald: 'border-l-emerald-500',
    amber: 'border-l-amber-500',
    blue: 'border-l-blue-500',
    violet: 'border-l-violet-500',
    neutral: 'border-l-neutral-400',
  };
  const iconBg: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    violet: 'bg-violet-100 text-violet-700',
    neutral: 'bg-neutral-200 text-neutral-700',
  };

  return (
    <section className="mt-8">
      <div
        className={cn(
          'mb-3 flex items-center gap-3 rounded-lg border-l-4 px-4 py-3',
          headerBg[color],
          borderColor[color],
        )}
      >
        <span className={cn('flex size-8 items-center justify-center rounded-full', iconBg[color])}>
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">{titulo}</h2>
          {descricao && <p className="text-xs opacity-80">{descricao}</p>}
        </div>
      </div>
      {ops.length === 0 ? (
        vazio ? (
          <Card className="items-center py-10 text-center">
            <CardContent className="flex flex-col items-center gap-2">
              <div className="flex size-10 items-center justify-center rounded-full bg-neutral-100">
                <Inbox className="size-5 text-neutral-500" />
              </div>
              <p className="text-sm text-neutral-600">{vazio}</p>
            </CardContent>
          </Card>
        ) : null
      ) : (
        <Card>
          <div className="divide-y divide-neutral-100">
            {ops.map((op) => (
              <Link
                key={op.id}
                href={`/operacoes/${op.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-emerald-50/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-neutral-900">{op.numero_processo}</div>
                  <div className="truncate text-xs text-neutral-500">
                    {op.cedente_nome} ·{' '}
                    {TIPOS_ATIVO.find((t) => t.value === op.tipo)?.label ?? op.tipo}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-medium text-neutral-900">
                    {fmtBRL(Number(op.valor_total))}
                  </div>
                  <div className="text-xs text-neutral-500">{op.dono?.nome ?? '—'}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <Badge className={classesEtapa(op.etapa_atual)}>
                    {labelEtapa(op.etapa_atual)}
                  </Badge>
                  <span className="text-[10px] tracking-wide text-neutral-400 uppercase">
                    {fmtRel(op.updated_at)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}
