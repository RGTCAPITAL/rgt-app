import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Bot, MessageCircle, UserRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { SectionHero } from '@/components/ui/section-hero';
import { fmtTelefone } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { esperaBroker, estadoJanela, ordenarConversas } from '@/lib/whatsapp/conversas';
import { whatsappConectado } from '@/lib/whatsapp/cloud-api';
import { conversasDemo, demoDisponivel } from './demo';
import { ROTULO_DADO, valorDado, type DadosColetados } from '@/lib/whatsapp/robo/schema';
import { nomeDaConversa, type ConversaLinha, type MensagemLinha } from './tipos';
import { Composer } from './composer';
import { AssumirConversa } from './assumir';
import { ConversasAoVivo } from './ao-vivo';

type SearchParams = { c?: string; demo?: string };

const FUSO = 'America/Sao_Paulo';

/** Hoje mostra a hora; antes disso, o dia. */
function quando(iso: string, agora: Date): string {
  const d = new Date(iso);
  const dia = (x: Date) => x.toLocaleDateString('pt-BR', { timeZone: FUSO });
  return dia(d) === dia(agora)
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO });
}

async function carregar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  selecionadaId: string | undefined,
) {
  // RLS decide o que aparece: broker vê só conversas de leads dele; admin e
  // gestão veem todas, inclusive as sem lead (número desconhecido escrevendo).
  const { data: brutas } = await supabase
    .from('whatsapp_conversas')
    .select(
      `id, telefone, nome_perfil, janela_expira_em, bot_pausado, pausado_motivo, status, updated_at, dados_coletados,
       lead:leads(id, nome, dono:usuarios!leads_dono_id_fkey(nome))`,
    )
    .order('updated_at', { ascending: false })
    .limit(200)
    .returns<(Omit<ConversaLinha, 'ultima' | 'ultima_em'> & { updated_at: string })[]>();

  const ids = (brutas ?? []).map((c) => c.id);
  const ultimas = new Map<string, MensagemLinha>();
  if (ids.length) {
    const { data } = await supabase
      .from('whatsapp_mensagens')
      .select('id, conversa_id, autor, conteudo, tipo, created_at')
      .in('conversa_id', ids)
      .order('created_at', { ascending: false })
      .limit(1000)
      .returns<(MensagemLinha & { conversa_id: string })[]>();
    for (const m of data ?? []) if (!ultimas.has(m.conversa_id)) ultimas.set(m.conversa_id, m);
  }

  const conversas: ConversaLinha[] = (brutas ?? []).map(({ updated_at, ...c }) => {
    const u = ultimas.get(c.id);
    return {
      ...c,
      ultima_em: u?.created_at ?? updated_at,
      ultima: u ? { autor: u.autor, conteudo: u.conteudo, tipo: u.tipo } : null,
    };
  });

  let mensagens: MensagemLinha[] = [];
  let optout = false;
  const selecionada = conversas.find((c) => c.id === selecionadaId);
  if (selecionada) {
    const [{ data: msgs }, { data: saiu }] = await Promise.all([
      supabase
        .from('whatsapp_mensagens')
        .select(
          `id, direcao, autor, conteudo, tipo, template_nome, status_entrega, created_at,
           autor_usuario:usuarios!whatsapp_mensagens_autor_id_fkey(nome)`,
        )
        .eq('conversa_id', selecionada.id)
        .order('created_at', { ascending: true })
        .limit(500)
        .returns<MensagemLinha[]>(),
      supabase
        .from('whatsapp_optout')
        .select('id')
        .eq('telefone', selecionada.telefone)
        .maybeSingle(),
    ]);
    mensagens = msgs ?? [];
    optout = Boolean(saiu);
  }

  return { conversas, mensagens, optout };
}

export default async function ConversasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
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
  const role = meuPerfil?.perfil?.slug;
  if (!role || !['admin', 'gestao', 'broker'].includes(role)) redirect('/');

  const demo = demoDisponivel(sp.demo);
  const conectado = whatsappConectado();
  const agora = new Date();

  let conversas: ConversaLinha[];
  let mensagens: MensagemLinha[];
  let optout = false;
  if (demo) {
    const d = conversasDemo(agora.getTime());
    conversas = d.conversas;
    mensagens = (sp.c && d.mensagens[sp.c]) || [];
  } else {
    ({ conversas, mensagens, optout } = await carregar(supabase, sp.c));
  }

  const ordenadas = ordenarConversas(conversas);
  const selecionada = ordenadas.find((c) => c.id === sp.c) ?? null;
  const esperando = ordenadas.filter(esperaBroker).length;
  const verTodas = role !== 'broker';
  const sufixo = demo ? '&demo=1' : '';

  return (
    <div>
      {/* Exemplo não está no banco: não há o que escutar. */}
      {!demo && <ConversasAoVivo />}
      <SectionHero
        title="Conversas"
        subtitle={
          esperando
            ? `${esperando} conversa${esperando === 1 ? '' : 's'} esperando você`
            : 'Nenhuma conversa esperando você'
        }
        color="emerald"
      />

      {demo ? (
        <p className="mb-4 rounded-md border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-900">
          Conversas de exemplo. Nada aqui está no banco, e o envio está desligado.
        </p>
      ) : (
        !conectado && (
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            O número da RGT ainda não está conectado ao WhatsApp. As conversas aparecem aqui quando
            estiver.
          </p>
        )
      )}

      <div className="grid h-[calc(100dvh-20rem)] min-h-[28rem] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm md:grid-cols-[20rem_1fr]">
        {/* Lista. No celular some quando uma conversa está aberta. */}
        <ul
          className={cn(
            'min-h-0 flex-col overflow-y-auto border-neutral-200 md:flex md:border-r',
            selecionada ? 'hidden' : 'flex',
          )}
        >
          {ordenadas.length === 0 && (
            <li className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-neutral-500">
              <MessageCircle className="size-8 text-neutral-300" />
              Nenhuma conversa ainda.
            </li>
          )}
          {ordenadas.map((c) => {
            const nome = nomeDaConversa(c);
            const espera = esperaBroker(c);
            const ativa = c.id === selecionada?.id;
            return (
              <li key={c.id}>
                <Link
                  href={`/conversas?c=${c.id}${sufixo}`}
                  className={cn(
                    'flex flex-col gap-0.5 border-b border-neutral-100 px-4 py-3 transition-colors',
                    ativa ? 'bg-emerald-50' : 'hover:bg-neutral-50',
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        'truncate text-sm',
                        espera ? 'font-semibold text-neutral-900' : 'text-neutral-800',
                      )}
                    >
                      {nome ?? fmtTelefone(c.telefone)}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {quando(c.ultima_em, agora)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-neutral-600">
                    {c.ultima?.autor === 'bot' && 'Robô: '}
                    {c.ultima?.autor === 'humano' && 'RGT: '}
                    {c.ultima?.conteudo ?? (c.ultima ? `[${c.ultima.tipo}]` : 'Sem mensagens')}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {espera && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
                        Esperando você
                      </span>
                    )}
                    {!c.bot_pausado && c.status !== 'encerrada' && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-800">
                        Robô atendendo
                      </span>
                    )}
                    {c.status === 'encerrada' && (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">
                        Encerrada
                      </span>
                    )}
                    {verTodas && !c.lead && (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-800">
                        Sem lead
                      </span>
                    )}
                    {verTodas && c.lead?.dono?.nome && (
                      <span className="text-neutral-500">{c.lead.dono.nome}</span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

        {selecionada ? (
          <Conversa
            c={selecionada}
            mensagens={mensagens}
            optout={optout}
            conectado={conectado}
            demo={demo}
            agora={agora}
          />
        ) : (
          <div className="hidden flex-col items-center justify-center gap-2 text-sm text-neutral-500 md:flex">
            <MessageCircle className="size-10 text-neutral-300" />
            Escolha uma conversa na lista.
          </div>
        )}
      </div>
    </div>
  );
}

function Conversa({
  c,
  mensagens,
  optout,
  conectado,
  demo,
  agora,
}: {
  c: ConversaLinha;
  mensagens: MensagemLinha[];
  optout: boolean;
  conectado: boolean;
  demo: boolean;
  agora: Date;
}) {
  const janela = estadoJanela(c.janela_expira_em, agora);
  const nome = nomeDaConversa(c);

  // A primeira recusa que valer é o que a caixa de texto mostra. Mesma ordem
  // da action, que confere tudo de novo no servidor.
  const bloqueio = demo
    ? 'Modo exemplo: o envio está desligado.'
    : optout
      ? 'Esta pessoa pediu pra não receber mais mensagens.'
      : c.status === 'encerrada'
        ? 'Conversa encerrada.'
        : !janela.aberta
          ? 'A janela de 24h está fechada. Só dá pra mandar um modelo aprovado pela Meta.'
          : !conectado
            ? 'O número da RGT ainda não está conectado ao WhatsApp.'
            : null;

  return (
    <section className="flex min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={`/conversas${demo ? '?demo=1' : ''}`}
            className="text-neutral-500 hover:text-neutral-800 md:hidden"
            aria-label="Voltar pra lista"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0">
            <p className="truncate font-semibold text-neutral-900">
              {nome ?? fmtTelefone(c.telefone)}
            </p>
            <p className="text-xs text-neutral-500">
              {fmtTelefone(c.telefone)}
              {' · '}
              <span className={cn(janela.fechandoLogo && 'font-medium text-amber-700')}>
                janela {janela.rotulo}
              </span>
            </p>
          </div>
        </div>
        {!c.bot_pausado && c.status !== 'encerrada' && (
          <AssumirConversa conversaId={c.id} desligado={demo} />
        )}
      </header>

      {c.bot_pausado && c.pausado_motivo && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <span className="font-semibold">Robô parado:</span> {c.pausado_motivo}
        </p>
      )}

      {c.dados_coletados && <DadosConfirmados dados={c.dados_coletados} />}

      {/* column-reverse: a rolagem já começa no fim, sem JavaScript. */}
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto bg-neutral-50 px-4 py-4">
        <ol className="flex flex-col gap-2">
          {mensagens.map((m) => (
            <Balao key={m.id} m={m} agora={agora} />
          ))}
        </ol>
      </div>

      <Composer conversaId={c.id} bloqueio={bloqueio} />
    </section>
  );
}

const STATUS_ENTREGA: Record<string, string> = {
  enviando: 'enviando…',
  enviada: 'enviada',
  entregue: 'entregue',
  lida: 'lida',
  falhou: 'falhou',
};

function Balao({ m, agora }: { m: MensagemLinha; agora: Date }) {
  const daRgt = m.direcao === 'saida';
  return (
    <li className={cn('flex flex-col gap-0.5', daRgt ? 'items-end' : 'items-start')}>
      {daRgt && (
        <span className="flex items-center gap-1 text-[11px] text-neutral-500">
          {m.autor === 'bot' ? (
            <>
              <Bot className="size-3" /> Robô
            </>
          ) : (
            <>
              <UserRound className="size-3" /> {m.autor_usuario?.nome ?? 'Equipe RGT'}
            </>
          )}
          {m.template_nome && <span className="text-neutral-400">· modelo aprovado</span>}
        </span>
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap shadow-sm sm:max-w-[70%]',
          !daRgt && 'bg-white text-neutral-900',
          m.autor === 'bot' && 'bg-blue-50 text-neutral-900',
          m.autor === 'humano' && 'bg-emerald-600 text-white',
        )}
      >
        {m.conteudo ?? <em className="opacity-70">[{m.tipo}]</em>}
      </div>
      <span className="text-[11px] text-neutral-400">
        {quando(m.created_at, agora)}
        {daRgt && m.status_entrega && (
          <span className={cn(m.status_entrega === 'falhou' && 'font-medium text-rose-600')}>
            {' · '}
            {STATUS_ENTREGA[m.status_entrega] ?? m.status_entrega}
          </span>
        )}
      </span>
    </li>
  );
}

/** O que a pessoa já confirmou ao robô. O broker lê antes de responder. */
function DadosConfirmados({ dados }: { dados: DadosColetados }) {
  const preenchidos = (Object.keys(ROTULO_DADO) as (keyof DadosColetados)[]).filter(
    (k) => dados[k] !== null && dados[k] !== undefined,
  );
  if (!preenchidos.length) return null;
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 border-b border-neutral-200 bg-white px-4 py-2 text-xs">
      <dt className="sr-only">Confirmado ao robô</dt>
      {preenchidos.map((k) => (
        <div key={k} className="flex gap-1">
          <dt className="text-neutral-500">{ROTULO_DADO[k]}:</dt>
          <dd className="font-medium text-neutral-900">{valorDado(dados[k])}</dd>
        </div>
      ))}
    </dl>
  );
}
