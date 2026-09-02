import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { labelEtapa } from '@/lib/workflow';
import { TIPOS_ATIVO } from './operacoes/nova/schemas';

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
function corEtapa(v: string): string {
  if (v === 'finalizada') return 'bg-emerald-100 text-emerald-800';
  if (v === 'cancelada') return 'bg-red-100 text-red-800';
  if (v === 'pagamento') return 'bg-blue-100 text-blue-800';
  return 'bg-neutral-100 text-neutral-700';
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

  // ===== Sem perfil: mostra aviso =====
  if (!perfil) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Bem-vindo</h1>
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <h3 className="font-semibold">⚠️ Aguardando definição de perfil</h3>
          <p className="mt-2">
            Sua conta foi criada mas ainda não tem perfil. Peça pro admin te promover em{' '}
            <code>/admin/usuarios</code>.
          </p>
        </div>
      </div>
    );
  }

  // ===== JURÍDICO — foco em DD =====
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
          <Kpi label="Em DD Jurídica" valor={String(totalDD ?? 0)} sub="aguardando seu parecer" />
          <Kpi
            label="Valor total em análise"
            valor={fmtBRL((ddJuridica ?? []).reduce((a, o) => a + Number(o.valor_total || 0), 0))}
            sub={`${ddJuridica?.length ?? 0} operações listadas abaixo`}
          />
        </div>
        <SectionOps
          titulo="Sua fila de due diligence"
          ops={ddJuridica ?? []}
          vazio="Nenhuma operação aguardando parecer jurídico agora."
        />
      </div>
    );
  }

  // ===== BROKER — foco em próprias operações =====
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
          />
          <Kpi label="Pipeline" valor={fmtBRL(valorTotalPipeline)} sub="valor total em andamento" />
          <Kpi label="Finalizadas (recentes)" valor={String(finalizadas)} sub="nas últimas 10" />
        </div>
        <SectionOps
          titulo="Suas operações recentes"
          ops={(minhas ?? []).slice(0, 5)}
          vazio="Você ainda não cadastrou nenhuma operação. Comece pelo botão acima."
        />
      </div>
    );
  }

  // ===== ADMIN / GESTÃO — visão global =====
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
      <Header
        primeiroNome={primeiroNome}
        perfilLabel={usuario?.perfis?.nome ?? 'Admin/Gestão'}
        cta
      />

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi
          label="Operações abertas"
          valor={String(totalAbertas)}
          sub="fora de finalizada/cancelada"
        />
        <Kpi label="Pipeline" valor={fmtBRL(totalPipeline)} sub="valor total em andamento" />
        <Kpi
          label="Prontas pra pagar"
          valor={String(prontas.length)}
          sub={prontas.length === 1 ? '1 operação' : `${prontas.length} operações`}
        />
        <Kpi
          label="Leads em aberto"
          valor={String(totalLeadsAbertos)}
          sub="pipeline CRM"
          linkPara="/crm"
        />
      </div>

      {filaAtencao.length > 0 && (
        <SectionOps
          titulo="⚠️ Precisa de atenção"
          descricao="Aceite pendente há mais de 7 dias · DD travada há mais de 14 dias"
          ops={filaAtencao}
          vazio=""
        />
      )}

      {prontas.length > 0 && (
        <SectionOps titulo="💰 Prontas pra pagamento" ops={prontas} vazio="" />
      )}

      <SectionOps
        titulo="🆕 Últimas cadastradas"
        ops={recentes}
        vazio="Nenhuma operação cadastrada ainda."
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
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
          {primeiroNome ? `Olá, ${primeiroNome}` : 'Bem-vindo'}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Painel <strong>{perfilLabel}</strong>. Panorama do que precisa da sua atenção agora.
        </p>
      </div>
      {cta && (
        <Link
          href="/operacoes/nova"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          + Nova operação
        </Link>
      )}
    </div>
  );
}

function Kpi({
  label,
  valor,
  sub,
  linkPara,
}: {
  label: string;
  valor: string;
  sub?: string;
  linkPara?: string;
}) {
  const inner = (
    <div className="rounded-md border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm">
      <div className="text-xs tracking-wide text-neutral-500 uppercase">{label}</div>
      <div className="mt-1 text-2xl font-bold text-neutral-900">{valor}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-500">{sub}</div>}
    </div>
  );
  return linkPara ? <Link href={linkPara}>{inner}</Link> : inner;
}

function SectionOps({
  titulo,
  descricao,
  ops,
  vazio,
}: {
  titulo: string;
  descricao?: string;
  ops: OpResumo[];
  vazio: string;
}) {
  return (
    <section className="mt-8">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-neutral-900">{titulo}</h2>
        {descricao && <p className="text-xs text-neutral-500">{descricao}</p>}
      </div>
      {ops.length === 0 ? (
        vazio ? (
          <p className="text-sm text-neutral-500">{vazio}</p>
        ) : null
      ) : (
        <div className="overflow-hidden rounded-md border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-neutral-100">
              {ops.map((op) => (
                <tr key={op.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/operacoes/${op.id}`}
                      className="font-medium text-neutral-900 hover:underline"
                    >
                      {op.numero_processo}
                    </Link>
                    <div className="text-xs text-neutral-500">
                      {op.cedente_nome} ·{' '}
                      {TIPOS_ATIVO.find((t) => t.value === op.tipo)?.label ?? op.tipo}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="font-medium text-neutral-900">
                      {fmtBRL(Number(op.valor_total))}
                    </div>
                    <div className="text-xs text-neutral-500">{op.dono?.nome ?? '—'}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${corEtapa(op.etapa_atual)}`}
                    >
                      {labelEtapa(op.etapa_atual)}
                    </span>
                    <div className="mt-0.5 text-[10px] tracking-wide text-neutral-400 uppercase">
                      {fmtRel(op.updated_at)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
