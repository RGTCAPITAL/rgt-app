import type { SupabaseClient } from '@supabase/supabase-js';
import { hojeEmSaoPaulo, somarDias } from '@/lib/datas';
import { decidirTarefaDoProcesso, type ConfigRegras } from '@/lib/regras/decidir';
import { carregarConfig, criarTarefaDeRegra, lerEmLotes, lerTudo } from '@/lib/regras/executar';
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
   * tarefa de reavaliar quando o Diário cita ofício requisitório.
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
  // Paginadas: o PostgREST corta em 1000 sem erro, e com a Prospecção
  // virando lead o rodízio passa disso. Erro LANÇA: seguir com a lista pela
  // metade faria processos "sumirem" do acompanhamento sem ninguém saber.
  type Linha = Record<string, unknown>;
  const [leads, ops, perdidos] = await Promise.all([
    lerTudo<Linha>('leads acompanhados', (de, ate) =>
      sb
        .from('leads')
        .select('id, nome, numero_processo, dono_id')
        .not('numero_processo', 'is', null)
        .not('status', 'in', '(ganho,perdido)')
        .eq('is_exemplo', false)
        .order('id')
        .range(de, ate),
    ),
    lerTudo<Linha>('operações acompanhadas', (de, ate) =>
      sb
        .from('operacoes')
        .select('id, cedente_nome, numero_processo, dono_id, broker_id')
        .not('numero_processo', 'is', null)
        .not('etapa_atual', 'in', '(finalizada,cancelada)')
        .eq('is_exemplo', false)
        .order('id')
        .range(de, ate),
    ),
    // Sem os perdidos a rotina segue: o que já existia não pode cair por
    // causa do que é novo.
    opts.incluirPerdidosSemOficio
      ? lerTudo<Linha>('perdidos sem ofício', (de, ate) =>
          sb
            .from('leads')
            .select('id, nome, numero_processo, dono_id, status_desde')
            .eq('status', 'perdido')
            .eq('motivo_perda_codigo', 'sem_oficio')
            .not('numero_processo', 'is', null)
            .eq('is_exemplo', false)
            .order('id')
            .range(de, ate),
        ).catch((e: unknown) => {
          console.error('[djen/acompanhamento]', e instanceof Error ? e.message : e);
          return [] as Linha[];
        })
      : Promise.resolve([] as Linha[]),
  ]);

  const porCnj = new Map<string, AlvoAcompanhado[]>();
  const add = (cnj: string | null, alvo: AlvoAcompanhado) => {
    if (!cnj) return;
    porCnj.set(cnj, [...(porCnj.get(cnj) ?? []), alvo]);
  };

  for (const l of leads) {
    add(cnj20(l.numero_processo as string), {
      tipo: 'lead',
      id: l.id as string,
      nome: l.nome as string,
      donos: l.dono_id ? [l.dono_id as string] : [],
      link: '/crm',
    });
  }
  for (const o of ops) {
    add(cnj20(o.numero_processo as string), {
      tipo: 'operacao',
      id: o.id as string,
      nome: (o.cedente_nome as string | null) ?? 'operação sem nome',
      donos: [...new Set([o.dono_id, o.broker_id].filter(Boolean) as string[])],
      link: `/operacoes/${o.id as string}`,
    });
  }
  for (const l of perdidos) {
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
 * Alvos que já têm tarefa ABERTA da regra "processo andou", separando a de
 * leitura da de reavaliar. Em processo movimentado sairia uma tarefa por dia;
 * com isto, publicação comum que chega com uma tarefa aberta fica só no aviso
 * do sino, e a urgente vira tarefa mesmo assim (decidirTarefaDoProcesso). Separado
 * porque uma "Ler publicação" esquecida de quando o lead estava ativo não
 * pode calar o aviso de reavaliar depois que ele vira perdido.
 */
async function alvosComTarefaAberta(sb: SupabaseClient): Promise<Set<string>> {
  const data = await lerTudo<{
    lead_id: string | null;
    operacao_id: string | null;
    chave_ciclo: string | null;
  }>('tarefas abertas da regra', (de, ate) =>
    sb
      .from('regras_disparos')
      .select('lead_id, operacao_id, chave_ciclo, tarefa:tarefas!inner(status)')
      .eq('regra', 'processo_andou')
      .in('tarefa.status', ['pendente', 'em_andamento'])
      .order('id')
      .range(de, ate),
  );
  return new Set(
    data.map((d) =>
      chaveAberta(
        d.lead_id ? 'lead' : 'operacao',
        (d.lead_id ?? d.operacao_id) as string,
        String(d.chave_ciclo ?? '').startsWith('reavaliar_perdido') ? 'reavaliar' : 'ler',
      ),
    ),
  );
}

const chaveAberta = (tipo: string, id: string, tipoTarefa: 'ler' | 'reavaliar') =>
  `${tipo}:${id}:${tipoTarefa}`;

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

  // Em lotes: com ~1.100 processos a lista de CNJs passa do limite de URL do
  // gateway. E erro lança: com "vistos" vazio, todo processo pareceria nunca
  // visto, as publicações novas virariam linha de base e o aviso se perderia.
  const vistos = await lerEmLotes<{ numero_processo: string; verificado_em: string }>(
    'djen_acompanhamento',
    [...alvos.keys()],
    (lote, de, ate) =>
      sb
        .from('djen_acompanhamento')
        .select('numero_processo, verificado_em')
        .in('numero_processo', lote)
        .order('numero_processo')
        .range(de, ate),
  );
  const vistoEm = new Map(vistos.map((v) => [v.numero_processo, v.verificado_em]));

  // Nunca vistos primeiro, depois os mais antigos. A cota de ~75 por dia é de
  // quem está em negociação, mas os processos que só têm lead perdido ganham
  // 1 vaga a cada 10, na frente (o prazo da função pode cortar o fim da
  // fila): sem vaga própria, com 75 processos ativos eles nunca seriam lidos
  // e o "reavaliar" que o modal de perda promete nunca sairia.
  const soPerdidos = (cnj: string) => alvos.get(cnj)!.every((a) => a.perdidoDesde);
  const porVisto = (a: string, b: string) =>
    (vistoEm.get(a) ?? '').localeCompare(vistoEm.get(b) ?? '');
  const perdidos = [...alvos.keys()].filter(soPerdidos).sort(porVisto);
  const emNegociacao = [...alvos.keys()].filter((c) => !soPerdidos(c)).sort(porVisto);
  const vagasPerdidos = Math.min(perdidos.length, Math.floor(limite / 10));
  const fila = [
    ...perdidos.slice(0, vagasPerdidos),
    ...emNegociacao,
    ...perdidos.slice(vagasPerdidos),
  ].slice(0, limite);

  let admins: string[] | null = null;
  let equipe: string[] | null = null;
  let gestao: string[] | null = null;

  for (const cnj of fila) {
    if (agora() > fim) break;
    try {
      const pubs = await buscarPorCnj(cnj);
      const { data: conhecidas } = await sb
        .from('djen_publicacoes')
        .select('id, data_disponibilizacao')
        .eq('numero_processo', cnj);
      const jaVisto = vistoEm.has(cnj) || (conhecidas?.length ?? 0) > 0;
      const idsConhecidos = new Set((conhecidas ?? []).map((p) => Number(p.id)));
      const novas = pubs.filter((p) => !idsConhecidos.has(p.id));

      // "Nova" de verdade é pela DATA, não pelo id: o DJEN às vezes devolve
      // uma publicação antiga que ainda não estava salva (entrou como nova uma
      // de 12/11/2025), e ela não é novidade nenhuma. O corte parte do que a
      // RGT JÁ TINHA: a publicação salva mais recente, menos 3 dias de folga
      // (fim de semana, DJEN atrasado). Assim o processo que veio da
      // Prospecção semanas atrás não perde o que saiu nesse meio-tempo (uma
      // cessão, por exemplo). Sem nada salvo, vale a última verificação.
      // Vale pra tarefa E pro aviso no sino.
      const hoje = hojeEmSaoPaulo(new Date(agora()));
      const ultimaSalva = (conhecidas ?? []).reduce((a, p) => {
        const d = (p as { data_disponibilizacao?: string | null }).data_disponibilizacao ?? '';
        return d > a ? d : a;
      }, '');
      const ultimaVez = vistoEm.get(cnj);
      const corteData = ultimaSalva
        ? somarDias(ultimaSalva.slice(0, 10), -3)
        : ultimaVez
          ? somarDias(hojeEmSaoPaulo(new Date(ultimaVez)), -3)
          : undefined;
      const recentes = corteData ? novas.filter((p) => p.dataDisponibilizacao >= corteData) : novas;

      // Quem já foi avisado pela tarefa criada agora (a trigger da 048 manda
      // "Nova tarefa" no sino): não recebe também o aviso genérico do mesmo
      // processo, que seria o mesmo recado duas vezes.
      const avisadoPelaTarefa = new Map<AlvoAcompanhado, Set<string>>();

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
                temTarefaAbertaDaRegra: abertas.has(
                  chaveAberta(alvo.tipo, alvo.id, alvo.perdidoDesde ? 'reavaliar' : 'ler'),
                ),
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
            abertas.add(chaveAberta(alvo.tipo, alvo.id, alvo.perdidoDesde ? 'reavaliar' : 'ler'));
            avisadoPelaTarefa.set(
              alvo,
              new Set(
                tarefa.destinatarioId
                  ? [tarefa.destinatarioId]
                  : (gestao ??= await idsDaEquipe(sb, ['gestao'])),
              ),
            );
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
        const jaAvisados = avisadoPelaTarefa.get(alvo);
        if (jaAvisados) para = para.filter((id) => !jaAvisados.has(id));
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
