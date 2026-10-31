import type { SupabaseClient } from '@supabase/supabase-js';
import { hojeEmSaoPaulo } from '@/lib/datas';
import { destinoDaTarefaDeRegra } from '@/lib/tarefas/repassar';
import {
  decidirRegrasDeLead,
  ETAPAS_LEAD_PARADO,
  lerConfig,
  ORIGENS_EM_MASSA,
  TUDO_DESLIGADO,
  type ChaveRegra,
  type ConfigRegras,
  type DisparoAnterior,
  type LeadNoCiclo,
  type LinhaRegra,
  type TarefaDeRegra,
} from './decidir';

/**
 * A parte das regras automáticas que fala com o banco. Roda com service role
 * (cron), então a RLS não filtra nada: quem decide o alcance é a consulta.
 *
 * A decisão em si — quem recebe tarefa, com qual texto — está em decidir.ts,
 * sem I/O, e é lá que mora a bateria de testes.
 */

/**
 * Lê as chaves liga/desliga. Erro de leitura conta como TUDO DESLIGADO, e não
 * como exceção: esta função também roda dentro do cron do DJEN, e uma tabela
 * ausente (deploy antes da migration 048) não pode derrubar o "processo
 * andou" que já existe. O motivo vai pro log da Vercel.
 */
export async function carregarConfig(sb: SupabaseClient): Promise<ConfigRegras> {
  const { data, error } = await sb.from('regras_automaticas').select('chave, ativa, parametros');
  if (error) {
    console.error('[regras] não consegui ler regras_automaticas; tudo desligado:', error.message);
    return TUDO_DESLIGADO;
  }
  return lerConfig((data ?? []) as LinhaRegra[]);
}

/**
 * Grava o disparo e a tarefa (RPC da 048, uma transação só). 'repetida' quer
 * dizer que a chave já existia ou que a regra foi desligada no meio da
 * rodada — não é falha. Erro de banco LANÇA: quem chama decide o que fazer.
 */
export async function criarTarefaDeRegra(
  sb: SupabaseClient,
  t: TarefaDeRegra,
): Promise<{ resultado: 'criada'; tarefaId: string } | { resultado: 'repetida' }> {
  const { data, error } = await sb.rpc('criar_tarefa_de_regra', {
    p_regra: t.regra,
    p_chave_ciclo: t.chaveCiclo,
    p_tentativa: t.tentativa,
    p_motivo: t.motivo,
    p_lead_id: t.leadId,
    p_operacao_id: t.operacaoId,
    p_destinatario_id: t.destinatarioId,
    p_destinatario_perfil: t.destinatarioPerfil,
    p_titulo: t.titulo,
    p_descricao: t.descricao,
    p_prazo: t.prazo,
  });
  if (error) throw new Error(error.message);
  return data ? { resultado: 'criada', tarefaId: data as string } : { resultado: 'repetida' };
}

export interface ResultadoRegras {
  regrasLigadas: ChaveRegra[];
  leadsAnalisados: number;
  tarefasCriadas: number;
  jaExistiam: number;
  falhas: number;
}

/** O max-rows padrão do PostgREST no Supabase. */
const PAGINA = 1000;
/**
 * Ids por consulta `.in()`. A lista vai inteira na URL, e o gateway do
 * Supabase recusa (400) a partir de ~650 uuids — medido em produção em 31/10.
 * Uma importação de 1000 linhas derrubaria a rodada inteira.
 */
const LOTE_IDS = 200;

type Resposta = { data: unknown; error: { message: string } | null };

/** Lança com o nome da consulta: no log da Vercel, "leads: …" diz onde parou. */
function exigir<T>(qual: string, r: Resposta): T {
  if (r.error) throw new Error(`${qual}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

/**
 * Todas as linhas, página por página: o PostgREST corta em 1000 sem dar erro,
 * e uma linha perdida no corte vira decisão errada (tarefa aberta que some,
 * resposta que não conta). A consulta tem de ter ordem total, senão a página
 * seguinte repete ou pula linha.
 */
export async function lerTudo<T>(
  qual: string,
  pagina: (de: number, ate: number) => PromiseLike<Resposta>,
): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const p = exigir<T[]>(qual, await pagina(de, de + PAGINA - 1));
    linhas.push(...p);
    if (p.length < PAGINA) return linhas;
  }
}

/** lerTudo para um `.in()` grande: lotes de LOTE_IDS, cada um paginado. */
export async function lerEmLotes<T>(
  qual: string,
  ids: readonly string[],
  pagina: (lote: string[], de: number, ate: number) => PromiseLike<Resposta>,
): Promise<T[]> {
  const linhas: T[] = [];
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const lote = ids.slice(i, i + LOTE_IDS);
    linhas.push(...(await lerTudo<T>(qual, (de, ate) => pagina(lote, de, ate))));
  }
  return linhas;
}

/**
 * DDD + 8 últimos dígitos: a mesma chave da whatsapp_chave_telefone (045/047).
 * A Meta às vezes devolve o número sem o nono dígito, e o lead tem o número
 * da planilha; só pela chave os dois se encontram.
 */
export function chaveTelefone(t: string | null | undefined): string | null {
  let d = (t ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d.slice(0, 2) + d.slice(-8) : null;
}

const maisRecente = (a: string | null | undefined, b: string | null | undefined) =>
  !a ? (b ?? null) : !b ? a : Date.parse(b) > Date.parse(a) ? b : a;

type LinhaLead = {
  id: string;
  nome: string;
  status: string;
  telefone: string | null;
  dono_id: string | null;
  origem: string;
  /** Só a importação de planilha grava: marca o lead como importado. */
  vinculo: string | null;
  status_desde: string;
  dono: { ativo: boolean } | null;
};

type LinhaTarefa = {
  id: string;
  lead_id: string;
  status: string;
  created_at: string;
  concluida_em: string | null;
  destinatario_id: string | null;
  destinatario: { ativo: boolean } | null;
};

type LinhaDisparo = {
  regra: ChaveRegra;
  lead_id: string;
  chave_ciclo: string;
  created_at: string;
  tarefa_id: string | null;
};

/**
 * A tarefa aberta segura as regras do lead? Tarefa pra um perfil (gestão)
 * sempre segura. Com uma pessoa que saiu da empresa, nunca: ninguém vai
 * fechá-la, e o lead ficaria travado para sempre. Com dono ativo, só a dele:
 * a esquecida com um dono antigo — que nem vê mais o lead — também travaria.
 * Sem dono, a de uma pessoa ativa segura (alguém pegou o lead).
 */
function seguraAsRegras(t: LinhaTarefa, donoAtivo: string | null): boolean {
  if (t.destinatario_id === null) return true;
  if (t.destinatario?.ativo === false) return false;
  return donoAtivo ? t.destinatario_id === donoAtivo : true;
}

/**
 * Uma rodada das regras (a) follow-up e (b) lead parado.
 *
 * Consultas em lote (e paginadas), uma decisão pura, uma RPC por tarefa.
 * Falha numa tarefa não para as outras: cada uma tem seu try.
 */
export async function rodarRegrasDeLead(
  sb: SupabaseClient,
  opts: { agora?: Date; config?: ConfigRegras } = {},
): Promise<ResultadoRegras> {
  const agora = opts.agora ?? new Date();
  const cfg = opts.config ?? (await carregarConfig(sb));
  const r: ResultadoRegras = {
    regrasLigadas: [
      ...(cfg.followUp.ativa ? (['follow_up'] as const) : []),
      ...(cfg.leadParado.ativa ? (['lead_parado'] as const) : []),
    ],
    leadsAnalisados: 0,
    tarefasCriadas: 0,
    jaExistiam: 0,
    falhas: 0,
  };
  // Nada ligado: nem consulta. É o estado normal até alguém ligar.
  if (!r.regrasLigadas.length) return r;

  // Só o follow-up ligado: só "Em contato" interessa.
  const etapas: string[] = cfg.leadParado.ativa ? [...ETAPAS_LEAD_PARADO] : ['em_contato'];
  const leads = await lerTudo<LinhaLead>('leads', (de, ate) => {
    let q = sb
      .from('leads')
      .select(
        'id, nome, status, telefone, dono_id, origem, vinculo, status_desde, dono:usuarios!leads_dono_id_fkey(ativo)',
      )
      .eq('is_exemplo', false)
      .in('status', etapas);
    // Importado em Novo nunca recebe tarefa (ver ETAPAS_LEAD_PARADO): sai já
    // aqui. Uma planilha de 1000 linhas encheria a rodada de leads que não
    // decidem nada. A decisão confere de novo.
    if (etapas.includes('novo')) {
      q = q.or(
        `status.neq.novo,and(vinculo.is.null,origem.not.in.(${ORIGENS_EM_MASSA.join(',')}))`,
      );
    }
    return q.order('id').range(de, ate);
  });
  r.leadsAnalisados = leads.length;
  if (!leads.length) return r;

  const ids = leads.map((l) => l.id);
  // O WhatsApp só importa pra quem está em "Em contato": no follow-up (houve
  // resposta?) e no texto do parado (quem respondeu não ouve "insista").
  const emContato = leads.filter((l) => l.status === 'em_contato');
  const inicioDoDia = `${hojeEmSaoPaulo(agora)}T03:00:00.000Z`; // 0h em São Paulo, sem horário de verão
  const [tarefas, linhasDisparo, conversas, paradosHoje] = await Promise.all([
    // Todas as tarefas do lead, abertas ou não: as abertas seguram as regras,
    // as criadas por uma PESSOA (retorno, tarefa à mão) contam como contato,
    // e criação e conclusão contam como movimento pro "lead parado".
    lerEmLotes<LinhaTarefa>('tarefas', ids, (lote, de, ate) =>
      sb
        .from('tarefas')
        .select(
          'id, lead_id, status, created_at, concluida_em, destinatario_id, destinatario:usuarios!tarefas_destinatario_id_fkey(ativo)',
        )
        .in('lead_id', lote)
        .order('id')
        .range(de, ate),
    ),
    // Todas as regras: as tarefas que elas criaram não contam como contato.
    lerEmLotes<LinhaDisparo>('regras_disparos', ids, (lote, de, ate) =>
      sb
        .from('regras_disparos')
        .select('regra, lead_id, chave_ciclo, created_at, tarefa_id')
        .in('lead_id', lote)
        .order('id')
        .range(de, ate),
    ),
    // Todas as conversas, e não só as com lead_id: a conversa é única por
    // telefone, e quando um advogado cuida de dois credores ela fica presa ao
    // primeiro lead. A resposta sobre o segundo só aparece pelo telefone.
    emContato.length
      ? lerTudo<{ id: string; lead_id: string | null; telefone: string | null }>(
          'whatsapp_conversas',
          (de, ate) =>
            sb
              .from('whatsapp_conversas')
              .select('id, lead_id, telefone')
              .order('id')
              .range(de, ate),
        )
      : Promise.resolve([]),
    cfg.leadParado.ativa
      ? lerTudo<{
          regra: string;
          created_at: string;
          tarefa: { destinatario_id: string | null } | null;
        }>('parados de hoje', (de, ate) =>
          sb
            .from('regras_disparos')
            .select('regra, created_at, tarefa:tarefas(destinatario_id)')
            .eq('regra', 'lead_parado')
            .gte('created_at', inicioDoDia)
            .order('id')
            .range(de, ate),
        )
      : Promise.resolve([]),
  ]);

  // Quantos "lead parado" cada pessoa já recebeu hoje (o teto é por dia).
  const jaHoje = new Map<string, number>();
  for (const d of paradosHoje) {
    if (d.regra !== 'lead_parado' || Date.parse(d.created_at) < Date.parse(inicioDoDia)) continue;
    if (!d.tarefa) continue; // tarefa apagada: ninguém está com ela
    const quem = d.tarefa.destinatario_id ?? 'gestao';
    jaHoje.set(quem, (jaHoje.get(quem) ?? 0) + 1);
  }

  // Qual regra criou cada tarefa (as de pessoa não estão aqui).
  const regraDaTarefa = new Map<string, ChaveRegra>();
  for (const d of linhasDisparo) if (d.tarefa_id) regraDaTarefa.set(d.tarefa_id, d.regra);
  const donoAtivo = new Map(
    leads.map((l) => [l.id, l.dono_id && l.dono?.ativo ? l.dono_id : null] as const),
  );

  // Tarefa ABERTA de regra que está com quem não é mais o responsável (dono
  // trocado antes de existir o repasse, dono desativado): vai pra quem a regra
  // escolheria hoje — o dono ativo, ou a gestão. A chave do ciclo impede a
  // regra de criar outra, então sem isto o aviso ficava com quem não lê.
  const repassar = new Map<string | null, string[]>();
  for (const t of tarefas) {
    if (!regraDaTarefa.has(t.id) || (t.status !== 'pendente' && t.status !== 'em_andamento')) {
      continue;
    }
    const certo = donoAtivo.get(t.lead_id) ?? null;
    if (t.destinatario_id === certo) continue;
    repassar.set(certo, [...(repassar.get(certo) ?? []), t.id]);
  }
  for (const [destino, idsTarefa] of repassar) {
    for (let i = 0; i < idsTarefa.length; i += LOTE_IDS) {
      const lote = idsTarefa.slice(i, i + LOTE_IDS);
      const { error } = await sb
        .from('tarefas')
        .update(destinoDaTarefaDeRegra(destino))
        .in('id', lote)
        .is('criado_por_id', null);
      if (error) {
        console.error('[regras] repasse de tarefas de regra:', error.message);
        continue;
      }
      for (const t of tarefas) {
        if (!lote.includes(t.id)) continue;
        t.destinatario_id = destino;
        t.destinatario = destino ? { ativo: true } : null;
      }
    }
  }

  const concluidaEm = new Map<string, string | null>();
  const comTarefaAberta = new Set<string>();
  const ultimaAcaoHumana = new Map<string, string>();
  const ultimaAtividade = new Map<string, string>();
  for (const t of tarefas) {
    concluidaEm.set(t.id, t.concluida_em);
    const regra = regraDaTarefa.get(t.id);
    const deRegra = regra !== undefined;
    if (
      (t.status === 'pendente' || t.status === 'em_andamento') &&
      seguraAsRegras(t, donoAtivo.get(t.lead_id) ?? null)
    ) {
      comTarefaAberta.add(t.lead_id);
    }
    // Concluir é sempre gesto de uma pessoa; criar, só se não foi a regra.
    // Ler uma publicação do Diário não é trabalhar o lead: a conclusão do
    // "processo andou" não mexe no relógio do parado.
    const movimento = !deRegra
      ? maisRecente(t.created_at, t.concluida_em)
      : regra === 'processo_andou'
        ? null
        : t.concluida_em;
    const atividade = maisRecente(ultimaAtividade.get(t.lead_id), movimento);
    if (atividade) ultimaAtividade.set(t.lead_id, atividade);
    if (deRegra) continue;
    const acao = maisRecente(ultimaAcaoHumana.get(t.lead_id), t.created_at);
    if (acao) ultimaAcaoHumana.set(t.lead_id, acao);
  }

  const disparosPorLead = new Map<string, DisparoAnterior[]>();
  for (const d of linhasDisparo) {
    if (d.regra !== 'follow_up' && d.regra !== 'lead_parado') continue;
    const lista = disparosPorLead.get(d.lead_id) ?? [];
    lista.push({
      regra: d.regra,
      chaveCiclo: d.chave_ciclo,
      criadoEm: d.created_at,
      concluidoEm: d.tarefa_id ? (concluidaEm.get(d.tarefa_id) ?? null) : null,
    });
    disparosPorLead.set(d.lead_id, lista);
  }

  // Conversas de cada lead em Em contato: as dele e as do mesmo telefone.
  const conversasDoLead = new Map<string, Set<string>>();
  if (conversas.length) {
    const porChave = new Map<string, string[]>();
    for (const c of conversas) {
      const k = chaveTelefone(c.telefone);
      if (k) porChave.set(k, [...(porChave.get(k) ?? []), c.id]);
    }
    for (const l of emContato) {
      const doLead = new Set(conversas.filter((c) => c.lead_id === l.id).map((c) => c.id));
      const k = chaveTelefone(l.telefone);
      for (const id of k ? (porChave.get(k) ?? []) : []) doLead.add(id);
      if (doLead.size) conversasDoLead.set(l.id, doLead);
    }
  }

  // Mensagens: só as RECEBIDAS, a partir da entrada mais antiga na etapa. O
  // resto da conversa não muda decisão nenhuma.
  const ultimaEntrada = new Map<string, string>();
  const idsConversa = [...new Set([...conversasDoLead.values()].flatMap((c) => [...c]))];
  if (idsConversa.length) {
    const desde = new Date(
      Math.min(...emContato.map((l) => Date.parse(l.status_desde))),
    ).toISOString();
    // Com o robô conversando, uma resposta perdida no corte de 1000 linhas
    // viraria follow-up pra quem respondeu: pagina até o fim, por data + id.
    type LinhaMsg = { conversa_id: string; direcao: string; created_at: string };
    const msgs = await lerEmLotes<LinhaMsg>('whatsapp_mensagens', idsConversa, (lote, de, ate) =>
      sb
        .from('whatsapp_mensagens')
        .select('conversa_id, direcao, created_at')
        .in('conversa_id', lote)
        .eq('direcao', 'entrada')
        .gte('created_at', desde)
        .order('created_at', { ascending: false })
        .order('id')
        .range(de, ate),
    );
    const ultimaDaConversa = new Map<string, string>();
    for (const m of msgs) {
      // O filtro já veio do banco; conferir de novo custa nada e impede que
      // uma mensagem ENVIADA conte como resposta.
      if (m.direcao !== 'entrada') continue;
      const atual = maisRecente(ultimaDaConversa.get(m.conversa_id), m.created_at);
      if (atual) ultimaDaConversa.set(m.conversa_id, atual);
    }
    for (const [leadId, convs] of conversasDoLead) {
      let ultima: string | null = null;
      for (const c of convs) ultima = maisRecente(ultima, ultimaDaConversa.get(c));
      if (ultima) ultimaEntrada.set(leadId, ultima);
    }
  }

  const noCiclo: LeadNoCiclo[] = leads.map((l) => ({
    id: l.id,
    nome: l.nome,
    status: l.status,
    // Dono inativo não lê tarefa: tratar como sem dono manda pra gestão.
    donoId: donoAtivo.get(l.id) ?? null,
    origem: l.origem,
    importado: l.vinculo !== null && l.vinculo !== undefined,
    statusDesde: l.status_desde,
    temTelefone: Boolean(l.telefone?.trim()),
    temConversaRgt: conversasDoLead.has(l.id),
    temTarefaAberta: comTarefaAberta.has(l.id),
    ultimaEntradaWhatsapp: ultimaEntrada.get(l.id) ?? null,
    ultimaAcaoHumana: ultimaAcaoHumana.get(l.id) ?? null,
    ultimaAtividade: ultimaAtividade.get(l.id) ?? null,
    disparos: disparosPorLead.get(l.id) ?? [],
  }));

  for (const acao of decidirRegrasDeLead(noCiclo, cfg, agora, jaHoje)) {
    try {
      const res = await criarTarefaDeRegra(sb, acao);
      if (res.resultado === 'criada') r.tarefasCriadas++;
      else r.jaExistiam++;
    } catch (e) {
      r.falhas++;
      console.error('[regras]', acao.regra, acao.leadId, e instanceof Error ? e.message : e);
    }
  }
  return r;
}
