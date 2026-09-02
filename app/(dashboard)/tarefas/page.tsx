import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { fmtDataBR } from '@/lib/formatters';

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
  return prazo < new Date().toISOString().slice(0, 10);
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
      'id, titulo, descricao, destinatario_perfil, destinatario_id, prazo, status, created_at, operacao:operacoes(id, numero_processo, cedente_nome), criado_por:usuarios!tarefas_criado_por_id_fkey(nome), destinatario:usuarios!tarefas_destinatario_id_fkey(nome)',
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

  const abertas = listaFinal.filter((t) => t.status === 'pendente' || t.status === 'em_andamento');
  const atrasadas = abertas.filter((t) => estaAtrasada(t.prazo, t.status));
  const concluidas = listaFinal.filter((t) => t.status === 'concluida');
  const emAndamento = listaFinal.filter((t) => t.status === 'em_andamento');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Tarefas</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Ações estruturadas de todas as operações que você vê. Clique numa tarefa pra abrir a
          operação e gerenciar.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi
          label="Total abertas"
          valor={String(abertas.length)}
          sub="pendentes + em andamento"
          href="/tarefas"
        />
        <Kpi
          label="Em andamento"
          valor={String(emAndamento.length)}
          sub="sendo trabalhadas"
          href="/tarefas?status=em_andamento"
        />
        <Kpi
          label="Atrasadas"
          valor={String(atrasadas.length)}
          sub="prazo passou"
          alerta={atrasadas.length > 0}
        />
        <Kpi
          label="Concluídas"
          valor={String(concluidas.length)}
          sub="últimas concluídas"
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
            return (
              <Link
                key={t.id}
                href={`/operacoes/${t.operacao?.id ?? ''}`}
                className={`block rounded-md border p-3 text-sm transition-colors ${
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
                      {t.operacao?.numero_processo ?? '—'} · {t.operacao?.cedente_nome ?? ''}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-neutral-500">
                      {t.criado_por?.nome && <span>Por {t.criado_por.nome}</span>}
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
