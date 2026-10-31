import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckSquare, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { fmtDataBR } from '@/lib/formatters';
import { SectionHero, KpiTile } from '@/components/ui/section-hero';
import { hojeEmSaoPaulo } from '@/lib/datas';
import { NOME_REGRA, type ChaveRegra } from '@/lib/regras/decidir';
import { ConcluirRetorno } from './concluir-retorno';

type SearchParams = { status?: string };

type TarefaLinha = {
  id: string;
  titulo: string;
  descricao: string | null;
  destinatario_perfil: string | null;
  destinatario_id: string | null;
  prazo: string | null;
  status: string;
  created_at: string;
  operacao: { id: string; numero_processo: string; cedente_nome: string } | null;
  /** Retorno agendado no CRM: a tarefa é do lead, não de uma operação. */
  lead: { id: string; nome: string } | null;
  criado_por: { nome: string | null } | null;
  destinatario: { nome: string | null } | null;
};

const STATUS_LABEL: Record<string, { label: string; cor: string }> = {
  pendente: { label: 'Pendente', cor: 'bg-neutral-100 text-neutral-700' },
  em_andamento: { label: 'Em andamento', cor: 'bg-blue-100 text-blue-800' },
  concluida: { label: 'Concluída', cor: 'bg-emerald-100 text-emerald-800' },
  cancelada: { label: 'Cancelada', cor: 'bg-red-100 text-red-800' },
};

const PERFIS_LABEL: Record<string, string> = {
  admin: 'Admin',
  gestao: 'Gestão',
  juridico: 'Jurídico',
  broker: 'Broker',
};

function estaAtrasada(prazo: string | null, status: string): boolean {
  if (!prazo || status === 'concluida' || status === 'cancelada') return false;
  return prazo < hojeEmSaoPaulo();
}

export default async function TarefasPage({
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

  const { data: meuPerfil } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();
  const meuSlug = meuPerfil?.perfil?.slug ?? '';

  // Puxa tarefas visíveis pelo user (RLS filtra por operação) e filtra:
  //   pra ele diretamente (destinatario_id = self OU destinatario_perfil = meu_slug)
  //   OU criadas por ele
  let query = supabase
    .from('tarefas')
    .select(
      'id, titulo, descricao, destinatario_perfil, destinatario_id, prazo, status, created_at, operacao:operacoes(id, numero_processo, cedente_nome), lead:leads(id, nome), criado_por:usuarios!tarefas_criado_por_id_fkey(nome), destinatario:usuarios!tarefas_destinatario_id_fkey(nome)',
    )
    .order('prazo', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (params.status) query = query.eq('status', params.status);

  const { data: todasTarefas } = await query.returns<TarefaLinha[]>();

  // Filtra client-side: relevante pra mim
  const tarefas = (todasTarefas ?? []).filter((t) => {
    return (
      t.destinatario_id === user.id ||
      (t.destinatario_perfil && t.destinatario_perfil === meuSlug) ||
      // criadas por mim (o join criado_por não traz id, então usamos SELECT extra... simplificando pra RLS)
      false
    );
  });

  // Fallback: se filtro server-side não encontra, mostra tudo que RLS deixa passar
  const listaFinal = tarefas.length > 0 || params.status ? tarefas : (todasTarefas ?? []);

  // Qual regra automática criou cada tarefa (migration 048). Consulta à parte,
  // e não embed: se ela falhar, a lista de tarefas aparece igual, só sem o
  // "Criada pela regra".
  const regraDaTarefa = new Map<string, ChaveRegra>();
  if (listaFinal.length) {
    const { data: disparos } = await supabase
      .from('regras_disparos')
      .select('tarefa_id, regra')
      .in(
        'tarefa_id',
        listaFinal.map((t) => t.id),
      )
      .returns<{ tarefa_id: string; regra: ChaveRegra }[]>();
    for (const d of disparos ?? []) regraDaTarefa.set(d.tarefa_id, d.regra);
  }

  const abertas = listaFinal.filter((t) => t.status === 'pendente' || t.status === 'em_andamento');
  const atrasadas = abertas.filter((t) => estaAtrasada(t.prazo, t.status));
  const concluidas = listaFinal.filter((t) => t.status === 'concluida');
  const emAndamento = listaFinal.filter((t) => t.status === 'em_andamento');

  return (
    <div>
      <SectionHero
        title="Central de Tarefas"
        subtitle="Ações estruturadas de todas as operações que você vê. Clique numa tarefa pra abrir a operação e gerenciar."
        color="amber"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiTile
          label="Total abertas"
          value={String(abertas.length)}
          sub="pendentes + em andamento"
          icon={CheckSquare}
          color="blue"
          href="/tarefas"
        />
        <KpiTile
          label="Em andamento"
          value={String(emAndamento.length)}
          sub="sendo trabalhadas"
          icon={Clock}
          color="amber"
          href="/tarefas?status=em_andamento"
        />
        <KpiTile
          label="Atrasadas"
          value={String(atrasadas.length)}
          sub="prazo passou"
          icon={AlertTriangle}
          color="rose"
        />
        <KpiTile
          label="Concluídas"
          value={String(concluidas.length)}
          sub="últimas concluídas"
          icon={CheckCircle}
          color="emerald"
          href="/tarefas?status=concluida"
        />
      </div>

      {listaFinal.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-600">
          Nenhuma tarefa por aqui. Crie tarefas dentro de uma operação (aba Tarefas).
        </div>
      ) : (
        <div className="space-y-2">
          {listaFinal.map((t) => {
            const stat = STATUS_LABEL[t.status] ?? STATUS_LABEL.pendente;
            const atrasada = estaAtrasada(t.prazo, t.status);
            // Retorno de lead não tem operação: o link ia pra "/operacoes/" (quebrado).
            const href = t.operacao ? `/operacoes/${t.operacao.id}` : '/crm';
            const aberta = t.status === 'pendente' || t.status === 'em_andamento';
            const temBotao = Boolean(t.lead && aberta);
            const regra = regraDaTarefa.get(t.id);
            return (
              <div key={t.id} className="relative">
                <Link
                  href={href}
                  // pr-28 reserva o lugar do botão "Concluir", que fica por
                  // cima do cartão: no celular ele cobria o título.
                  className={`block rounded-md border p-3 text-sm transition-colors ${temBotao ? 'pr-28' : ''} ${
                    atrasada
                      ? 'border-red-300 bg-red-50/50 hover:bg-red-50'
                      : 'border-neutral-200 bg-white hover:bg-neutral-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${stat.cor}`}
                        >
                          {stat.label}
                        </span>
                        {atrasada && (
                          <span className="rounded-full bg-red-200 px-2 py-0.5 text-[10px] font-medium text-red-800">
                            Atrasada
                          </span>
                        )}
                        <span className="font-medium text-neutral-900">{t.titulo}</span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-600">
                        {t.operacao
                          ? `${t.operacao.numero_processo} · ${t.operacao.cedente_nome}`
                          : t.lead
                            ? `${regra ? 'Lead' : 'Retorno de lead'} · ${t.lead.nome}`
                            : '—'}
                      </p>
                      {/* A instrução da tarefa automática mora aqui: o título
                          só diz o quê, a descrição diz como. A da regra sai
                          inteira (a última linha pode ser "esta é a última
                          tentativa"); a escrita à mão corta em 4 linhas. */}
                      {t.descricao && (
                        <p
                          className={`mt-1 text-xs break-words whitespace-pre-line text-neutral-600 ${regra ? '' : 'line-clamp-4'}`}
                        >
                          {t.descricao}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-neutral-500">
                        {regra ? (
                          <span>Criada pela regra {NOME_REGRA[regra]}</span>
                        ) : (
                          t.criado_por?.nome && <span>Por {t.criado_por.nome}</span>
                        )}
                        <span>
                          Para:{' '}
                          {t.destinatario?.nome ??
                            (t.destinatario_perfil ? PERFIS_LABEL[t.destinatario_perfil] : '—')}
                        </span>
                        {t.prazo && (
                          <span className={atrasada ? 'font-medium text-red-700' : ''}>
                            Prazo {fmtDataBR(t.prazo)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
                {/* Fora do <Link>: botão dentro de âncora é HTML inválido e o clique navegaria. */}
                {temBotao && (
                  <div className="absolute top-3 right-3">
                    <ConcluirRetorno tarefaId={t.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  valor,
  sub,
  href,
  alerta,
}: {
  label: string;
  valor: string;
  sub?: string;
  href?: string;
  alerta?: boolean;
}) {
  const cls = `rounded-md border p-4 transition-shadow hover:shadow-sm ${
    alerta ? 'border-red-300 bg-red-50' : 'border-neutral-200 bg-white'
  }`;
  const inner = (
    <div className={cls}>
      <div
        className={`text-xs tracking-wide uppercase ${alerta ? 'text-red-700' : 'text-neutral-500'}`}
      >
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${alerta ? 'text-red-900' : 'text-neutral-900'}`}>
        {valor}
      </div>
      {sub && (
        <div className={`mt-0.5 text-xs ${alerta ? 'text-red-700' : 'text-neutral-500'}`}>
          {sub}
        </div>
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
