import Link from 'next/link';
import { redirect } from 'next/navigation';
import { exigirPerfil } from '@/lib/auth/roles';
import { lerConfig, type ChaveRegra, type LinhaRegra } from '@/lib/regras/decidir';
import { createClient } from '@/lib/supabase/server';
import { SectionHero } from '@/components/ui/section-hero';
import { PainelRegras, type RegraVista } from './painel-regras';

type RegraRow = LinhaRegra & {
  chave: ChaveRegra;
  nome: string;
  updated_at: string;
  atualizado_por: { nome: string | null } | null;
};

type DisparoRow = {
  id: string;
  regra: ChaveRegra;
  tentativa: number;
  motivo: string;
  created_at: string;
  lead: { id: string; nome: string } | null;
  operacao: { id: string; cedente_nome: string | null } | null;
  tarefa: {
    status: string;
    destinatario_perfil: string | null;
    destinatario: { nome: string | null } | null;
  } | null;
};

const ORDEM: ChaveRegra[] = ['follow_up', 'lead_parado', 'processo_andou'];

const ROTULO_REGRA: Record<ChaveRegra, string> = {
  follow_up: 'Follow-up',
  lead_parado: 'Lead parado',
  processo_andou: 'Processo andou',
};

const STATUS_TAREFA: Record<string, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

const PERFIL: Record<string, string> = {
  admin: 'Admin',
  gestao: 'Gestão',
  juridico: 'Jurídico',
  broker: 'Broker',
};

// Fuso fixo: o servidor da Vercel roda em UTC.
const dataHoraSP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export default async function RegrasPage() {
  const auth = await exigirPerfil(['admin', 'gestao']);
  if (!auth.ok) redirect('/');

  const supabase = await createClient();
  const [{ data: regras }, { data: disparos }] = await Promise.all([
    supabase
      .from('regras_automaticas')
      .select('chave, nome, ativa, parametros, updated_at, atualizado_por:usuarios(nome)')
      .returns<RegraRow[]>(),
    supabase
      .from('regras_disparos')
      .select(
        `id, regra, tentativa, motivo, created_at,
         lead:leads(id, nome),
         operacao:operacoes(id, cedente_nome),
         tarefa:tarefas(status, destinatario_perfil,
           destinatario:usuarios!tarefas_destinatario_id_fkey(nome))`,
      )
      .order('created_at', { ascending: false })
      .limit(30)
      .returns<DisparoRow[]>(),
  ]);

  // A tela mostra o que a rotina vai fazer de fato: parâmetro inválido no
  // banco aparece como desligado, porque é assim que a rotina o trata.
  const cfg = lerConfig(regras ?? []);
  const efetiva: Record<ChaveRegra, { ativa: boolean; valida: boolean }> = {
    follow_up: cfg.followUp,
    lead_parado: cfg.leadParado,
    processo_andou: cfg.processoAndou,
  };
  const vistas: RegraVista[] = ORDEM.flatMap((chave) => {
    const row = (regras ?? []).find((r) => r.chave === chave);
    if (!row) return [];
    return [
      {
        chave,
        nome: row.nome,
        ativa: efetiva[chave].ativa,
        valida: efetiva[chave].valida,
        dias:
          chave === 'follow_up'
            ? cfg.followUp.dias
            : chave === 'lead_parado'
              ? cfg.leadParado.dias
              : null,
        maxTentativas: chave === 'follow_up' ? cfg.followUp.maxTentativas : null,
        alteradaPor: row.atualizado_por?.nome ?? null,
        alteradaEm: row.updated_at,
      },
    ];
  });

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHero
        title="Regras automáticas"
        subtitle="Cada regra cria uma tarefa para uma pessoa da equipe. Nenhuma manda mensagem pro cliente."
        color="neutral"
      />

      <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-4 text-xs text-neutral-600">
        <div className="mb-2 font-medium text-neutral-900">Como isto é usado</div>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            As regras rodam uma vez por dia, de manhã (entre 9h e 10h), e começam desligadas. Ligar
            ou mudar um número vale a partir da rodada seguinte.
          </li>
          <li>A tarefa aparece em Tarefas, no card do lead e no sino de quem recebe.</li>
          <li>
            Lead sem dono, ou com dono inativo, gera tarefa para a gestão. Os leads e operações de
            exemplo ficam de fora.
          </li>
          <li>
            Para os leads que já existiam quando as regras foram instaladas, a contagem de dias
            começa na instalação, e não no dia em que entraram na etapa.
          </li>
        </ul>
      </div>

      {vistas.length < ORDEM.length && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Alguma regra não foi encontrada no banco. Confira se a migration 048 foi aplicada.
        </p>
      )}

      <PainelRegras regras={vistas} />

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Últimos atingidos</h2>
        {!disparos?.length ? (
          <div className="rounded-md border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-600">
            Nenhuma regra atingiu ninguém ainda. Ligue uma regra acima; a primeira rodada é na manhã
            seguinte.
          </div>
        ) : (
          // Lista e não tabela: no celular uma tabela de seis colunas rolaria de lado.
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
            {disparos.map((d) => {
              const alvo = d.lead
                ? { nome: d.lead.nome, href: `/crm?lead=${d.lead.id}` }
                : d.operacao
                  ? {
                      nome: d.operacao.cedente_nome ?? 'Operação sem nome',
                      href: `/operacoes/${d.operacao.id}`,
                    }
                  : null;
              const para =
                d.tarefa?.destinatario?.nome ??
                (d.tarefa?.destinatario_perfil ? PERFIL[d.tarefa.destinatario_perfil] : null);
              return (
                <li
                  key={d.id}
                  className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {alvo ? (
                        <Link
                          href={alvo.href}
                          className="font-medium break-words text-neutral-900 underline-offset-2 hover:underline"
                        >
                          {alvo.nome}
                        </Link>
                      ) : (
                        <span className="text-neutral-500">Removido</span>
                      )}
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-700">
                        {ROTULO_REGRA[d.regra] ?? d.regra}
                        {d.regra === 'follow_up' && ` · tentativa ${d.tentativa}`}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs break-words text-neutral-600">{d.motivo}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-x-3 text-[11px] text-neutral-500 sm:flex-col sm:items-end sm:text-right">
                    <span>{dataHoraSP.format(new Date(d.created_at))}</span>
                    {para && <span>para {para}</span>}
                    <span>
                      {d.tarefa
                        ? `Tarefa ${(STATUS_TAREFA[d.tarefa.status] ?? d.tarefa.status).toLowerCase()}`
                        : 'Tarefa apagada'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
