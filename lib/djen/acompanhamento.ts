import type { SupabaseClient } from '@supabase/supabase-js';
import { hojeEmSaoPaulo, somarDias } from '@/lib/datas';
import { decidirTarefaDoProcesso, type ConfigRegras } from '@/lib/regras/decidir';
import { carregarConfig, criarTarefaDeRegra } from '@/lib/regras/executar';
import { buscarPorCnj } from './client';
import { paraLinhaBanco } from './mappers';
import { infoRedFlag, ordenarFlagsParaExibir, temAlertaGrave } from './red-flags';
import type { Publicacao } from './types';

/**
 * "O processo andou": todo dia, olha o DJEN dos processos que a RGT está
 * negociando ou operando e avisa o dono quando sai publicação nova.
 *
 * Por que importa: precatório pago, cedido a outro comprador ou penhorado mata
 * o negócio — e sem isso ninguém fica sabendo até ligar pro credor. O DJEN
 * só era lido quando alguém clicava em enriquecer.
 *
 * Primeira vez que um processo é visto não gera aviso: o histórico inteiro
 * seria "novo", e o broker receberia vinte avisos de coisas de 2024. A
 * primeira passada só registra a linha de base.
 *
 * Com a regra automática "processo andou" ligada (/admin/regras, migration
 * 048), a mesma passada também CRIA TAREFA pro dono ler a publicação — e olha
 * os leads perdidos "sem ofício", pra avisar quando o ofício sair. Ninguém é
 * reaberto sozinho: a tarefa pede pra uma pessoa reavaliar.
 */

export interface AlvoAcompanhado {
  tipo: 'lead' | 'operacao';
  id: string;
  nome: string;
  /** Quem recebe o aviso. Vazio: vai pra admin e gestão. */
  donos: string[];
  link: string;
  /**
   * Só pra lead perdido "sem ofício" (entra na fila quando a regra está
   * ligada): quando virou Perdido. Esse alvo não gera o aviso genérico, só a
   * tarefa de reavaliar quando o Diário mostra ofício expedido.
   */
  perdidoDesde?: string;
}

export interface ResumoNovidades {
  titulo: string;
  descricao: string;
  urgente: boolean;
}

function fmtData(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/**
 * O texto do aviso. Mostra o sinal mais importante em português (cessão e
 * pagamento antes de ofício, ofício antes de aviso amarelo) e conta o resto.
 * Alerta grave — alguém comprou, foi pago, penhora — vira urgente.
 */
export function resumirNovidades(nome: string, novas: readonly Publicacao[]): ResumoNovidades {
  const codigos = ordenarFlagsParaExibir([
    ...new Set(novas.flatMap((p) => p.redFlags.map((f) => f.codigo))),
  ]).filter((c) => c !== 'X7'); // boilerplate de toda expedição: não é notícia
  const urgente = temAlertaGrave(codigos);
  const maisRecente = novas.reduce(
    (a, p) => (p.dataDisponibilizacao > a ? p.dataDisponibilizacao : a),
    '',
  );

  const qtd = novas.length === 1 ? '1 publicação nova' : `${novas.length} publicações novas`;
  const sinal = codigos.length
    ? ` ${infoRedFlag(codigos[0]).descricaoHumana}${codigos.length > 1 ? ` (+${codigos.length - 1} sinal${codigos.length > 2 ? 's' : ''})` : ''}`
    : ` ${novas[0]?.tipoDocumento || novas[0]?.tipoComunicacao || 'Leia a publicação.'}`;

  return {
    titulo: urgente
      ? `ATENÇÃO: o processo de ${nome} teve publicação grave`
      : `Processo andou: ${nome}`,
    descricao: `${qtd} no Diário${maisRecente ? ` (${fmtData(maisRecente)})` : ''}.${sinal}`,
    urgente,
  };
}

function cnj20(numero: string | null): string | null {
  const d = (numero ?? '').replace(/\D/g, '');
  return d.length === 20 ? d : null;
}

/**
 * Processos acompanhados: leads ainda em negociação e operações em andamento.
 * Dado de exemplo fica de fora — o número de processo pode até ser real, e
 * avisar sobre ele confundiria.
 *
 * Com `incluirPerdidosSemOficio`, entram também os leads perdidos porque o
 * ofício ainda não tinha saído: é o Diário que vai dizer quando reavaliar.
 */
export async function carregarAlvos(
  sb: SupabaseClient,
  opts: { incluirPerdidosSemOficio?: boolean } = {},
): Promise<Map<string, AlvoAcompanhado[]>> {
  const [{ data: leads }, { data: ops }, { data: perdidos, error: erroPerdidos }] =
    await Promise.all([
      sb
        .from('leads')
        .select('id, nome, numero_processo, dono_id')
        .not('numero_processo', 'is', null)
        .not('status', 'in', '(ganho,perdido)')
        .eq('is_exemplo', false),
      sb
        .from('operacoes')
        .select('id, cedente_nome, numero_processo, dono_id, broker_id')
        .not('numero_processo', 'is', null)
        .not('etapa_atual', 'in', '(finalizada,cancelada)')
        .eq('is_exemplo', false),
      opts.incluirPerdidosSemOficio
        ? sb
            .from('leads')
            .select('id, nome, numero_processo, dono_id, status_desde')
            .eq('status', 'perdido')
            .eq('motivo_perda_codigo', 'sem_oficio')
            .not('numero_processo', 'is', null)
            .eq('is_exemplo', false)
        : Promise.resolve({ data: [], error: null }),
    ]);
  // Sem os perdidos a rotina segue: o que já existia não pode cair por causa
  // do que é novo.
  if (erroPerdidos)
    console.error('[djen/acompanhamento] perdidos sem ofício:', erroPerdidos.message);

  const porCnj = new Map<string, AlvoAcompanhado[]>();
  const add = (cnj: string | null, alvo: AlvoAcompanhado) => {
    if (!cnj) return;
    porCnj.set(cnj, [...(porCnj.get(cnj) ?? []), alvo]);
  };

  for (const l of leads ?? []) {
    add(cnj20(l.numero_processo as string), {
      tipo: 'lead',
      id: l.id as string,
      nome: l.nome as string,
      donos: l.dono_id ? [l.dono_id as string] : [],
      link: '/crm',
    });
  }
  for (const o of ops ?? []) {
    add(cnj20(o.numero_processo as string), {
      tipo: 'operacao',
      id: o.id as string,
      nome: (o.cedente_nome as string | null) ?? 'operação sem nome',
      donos: [...new Set([o.dono_id, o.broker_id].filter(Boolean) as string[])],
      link: `/operacoes/${o.id as string}`,
    });
  }
  for (const l of (perdidos ?? []) as Record<string, unknown>[]) {
    add(cnj20(l.numero_processo as string), {
      tipo: 'lead',
      id: l.id as string,
      nome: l.nome as string,
      donos: l.dono_id ? [l.dono_id as string] : [],
      link: '/crm',
      perdidoDesde: l.status_desde as string,
    });
  }
  return porCnj;
}

/**
 * Alvos que já têm tarefa ABERTA da regra "processo andou". Em processo
 * movimentado sairia uma tarefa por dia; com isto, a próxima só sai depois de
 * a pessoa fechar a anterior.
 */
async function alvosComTarefaAberta(sb: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await sb
    .from('regras_disparos')
    .select('lead_id, operacao_id, tarefa:tarefas!inner(status)')
    .eq('regra', 'processo_andou')
    .in('tarefa.status', ['pendente', 'em_andamento']);
  if (error) throw new Error(`tarefas abertas da regra: ${error.message}`);
  return new Set(
    (data ?? []).map((d) =>
      d.lead_id ? `lead:${d.lead_id as string}` : `operacao:${d.operacao_id as string}`,
    ),
  );
}

async function idsDaEquipe(sb: SupabaseClient, slugs: string[]): Promise<string[]> {
  const { data: perfis } = await sb.from('perfis').select('id').in('slug', slugs);
  const { data } = await sb
    .from('usuarios')
    .select('id')
    .eq('ativo', true)
    .in(
      'perfil_id',
      (perfis ?? []).map((p) => p.id),
    );
  return (data ?? []).map((u) => u.id as string);
}

export interface ResultadoAcompanhamento {
  acompanhados: number;
  verificados: number;
  comNovidade: number;
  linhaDeBase: number;
  avisos: number;
  /** Tarefas criadas pela regra "processo andou" (0 com a regra desligada). */
  tarefas: number;
  falhas: number;
}

/**
 * Uma passada. Começa pelos processos vistos há mais tempo, e para antes do
 * prazo da função: o DJEN aceita 20 consultas por minuto (o cliente já espera
 * entre uma e outra), e a função tem 5 minutos.
 */
export async function acompanharProcessos(
  sb: SupabaseClient,
  opts: {
    limite?: number;
    prazoMs?: number;
    agora?: () => number;
    /** Nos testes, no lugar de ler regras_automaticas. */
    config?: ConfigRegras;
  } = {},
): Promise<ResultadoAcompanhamento> {
  const limite = opts.limite ?? 75;
  const agora = opts.agora ?? Date.now;
  const fim = agora() + (opts.prazoMs ?? 270_000);

  // Erro ao ler a config conta como desligada (ver carregarConfig): o aviso
  // que já existia continua saindo.
  const regraLigada = (opts.config ?? (await carregarConfig(sb))).processoAndou.ativa;

  const alvos = await carregarAlvos(sb, { incluirPerdidosSemOficio: regraLigada });
  const r: ResultadoAcompanhamento = {
    acompanhados: alvos.size,
    verificados: 0,
    comNovidade: 0,
    linhaDeBase: 0,
    avisos: 0,
    tarefas: 0,
    falhas: 0,
  };
  if (!alvos.size) return r;

  // Se esta consulta falhar, a regra fica de fora hoje e o aviso segue.
  let comTarefaAberta: Set<string> | null = null;
  if (regraLigada) {
    try {
      comTarefaAberta = await alvosComTarefaAberta(sb);
    } catch (e) {
      console.error('[djen/acompanhamento]', e instanceof Error ? e.message : e);
    }
  }
  // Responsável que saiu da empresa não lê tarefa: cai pra gestão.
  let ativos: Set<string> | null = null;
  const usuariosAtivos = async () => {
    if (ativos) return ativos;
    const { data, error } = await sb.from('usuarios').select('id').eq('ativo', true);
    if (error) throw new Error(`usuários ativos: ${error.message}`);
    return (ativos = new Set((data ?? []).map((u) => u.id as string)));
  };

  const { data: vistos } = await sb
    .from('djen_acompanhamento')
    .select('numero_processo, verificado_em')
    .in('numero_processo', [...alvos.keys()]);
  const vistoEm = new Map(
    (vistos ?? []).map((v) => [v.numero_processo as string, v.verificado_em as string]),
  );

  // Nunca vistos primeiro, depois os mais antigos. Processo que só tem lead
  // perdido vai pro fim: a cota de ~75 por dia é de quem está em negociação.
  const soPerdidos = (cnj: string) => alvos.get(cnj)!.every((a) => a.perdidoDesde);
  const fila = [...alvos.keys()]
    .sort(
      (a, b) =>
        Number(soPerdidos(a)) - Number(soPerdidos(b)) ||
        (vistoEm.get(a) ?? '').localeCompare(vistoEm.get(b) ?? ''),
    )
    .slice(0, limite);

  let admins: string[] | null = null;
  let equipe: string[] | null = null;

  for (const cnj of fila) {
    if (agora() > fim) break;
    try {
      const pubs = await buscarPorCnj(cnj);
      const { data: conhecidas } = await sb
        .from('djen_publicacoes')
        .select('id')
        .eq('numero_processo', cnj);
      const jaVisto = vistoEm.has(cnj) || (conhecidas?.length ?? 0) > 0;
      const idsConhecidos = new Set((conhecidas ?? []).map((p) => Number(p.id)));
      const novas = pubs.filter((p) => !idsConhecidos.has(p.id));

      // "Nova" de verdade é pela DATA, não pelo id: o DJEN às vezes devolve
      // uma publicação antiga que ainda não estava salva (entrou como nova uma
      // de 12/11/2025), e ela não é novidade nenhuma. Corte: a última
      // verificação menos 3 dias de folga (fim de semana, DJEN atrasado).
      // Processo sem verificação mas com publicações salvas (veio da
      // Prospecção) olha só os últimos 7 dias: o resto ficou pra trás.
      // Vale pra tarefa E pro aviso no sino.
      const hoje = hojeEmSaoPaulo(new Date(agora()));
      const ultimaVez = vistoEm.get(cnj);
      const corteData = ultimaVez
        ? somarDias(hojeEmSaoPaulo(new Date(ultimaVez)), -3)
        : somarDias(hoje, -7);
      const recentes = novas.filter((p) => p.dataDisponibilizacao >= corteData);

      // Tarefas ANTES de gravar as publicações: se algo falhar daqui pra
      // frente, amanhã elas continuam "novas" e a tarefa sai; a chave da 048
      // impede que saia em dobro.
      if (comTarefaAberta) {
        const abertas = comTarefaAberta;
        for (const alvo of alvos.get(cnj)!) {
          const decidir = (destinatarioId: string | null) =>
            decidirTarefaDoProcesso(
              { ...alvo, cnj, destinatarioId },
              {
                novas: recentes,
                todas: pubs,
                jaVisto,
                temTarefaAbertaDaRegra: abertas.has(`${alvo.tipo}:${alvo.id}`),
                corteData,
              },
              resumirNovidades(alvo.nome, recentes),
              hoje,
            );
          // Quase todo dia a resposta é "nada": só então vale ler quem está
          // ativo (uma consulta por rodada, não por processo).
          if (!decidir(null)) continue;
          const ativosAgora = await usuariosAtivos();
          const tarefa = decidir(alvo.donos.find((id) => ativosAgora.has(id)) ?? null)!;
          const res = await criarTarefaDeRegra(sb, tarefa);
          if (res.resultado === 'criada') {
            r.tarefas++;
            abertas.add(`${alvo.tipo}:${alvo.id}`);
          }
        }
      }

      if (novas.length) {
        const { error } = await sb
          .from('djen_publicacoes')
          .upsert(novas.map(paraLinhaBanco), { onConflict: 'id' });
        if (error) throw new Error(error.message);
      }

      await sb.from('djen_acompanhamento').upsert({
        numero_processo: cnj,
        verificado_em: new Date(agora()).toISOString(),
        ultima_publicacao: pubs[0]?.dataDisponibilizacao ?? null,
      });
      r.verificados++;

      if (!jaVisto) {
        r.linhaDeBase++;
        continue;
      }
      // As antigas foram gravadas acima (viram conhecidas), mas não avisam.
      if (!recentes.length) continue;
      r.comNovidade++;

      const notifs = [];
      // Lead perdido não recebe o aviso genérico: pra ele só importa o ofício,
      // e isso vira tarefa de reavaliar (acima).
      for (const alvo of alvos.get(cnj)!.filter((a) => !a.perdidoDesde)) {
        const resumo = resumirNovidades(alvo.nome, recentes);
        let para = alvo.donos;
        if (!para.length) para = equipe ??= await idsDaEquipe(sb, ['admin', 'gestao']);
        if (resumo.urgente)
          para = [...new Set([...para, ...(admins ??= await idsDaEquipe(sb, ['admin']))])];
        for (const destinatario of para) {
          notifs.push({
            destinatario,
            tipo: 'processo_andou',
            titulo: resumo.titulo,
            descricao: resumo.descricao,
            link: alvo.link,
          });
        }
      }
      if (notifs.length) {
        const { error } = await sb.from('notificacoes').insert(notifs);
        if (error) throw new Error(error.message);
        r.avisos += notifs.length;
      }
    } catch (e) {
      r.falhas++;
      console.error('[djen/acompanhamento]', cnj, e instanceof Error ? e.message : e);
    }
  }
  return r;
}
