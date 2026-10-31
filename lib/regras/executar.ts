import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decidirRegrasDeLead,
  ETAPAS_LEAD_PARADO,
  lerConfig,
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

/** Lança com o nome da consulta: no log da Vercel, "leads: …" diz onde parou. */
function exigir<T>(qual: string, r: { data: unknown; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${qual}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

type LinhaLead = {
  id: string;
  nome: string;
  status: string;
  dono_id: string | null;
  origem: string;
  status_desde: string;
  dono: { ativo: boolean } | null;
};

/**
 * Uma rodada das regras (a) follow-up e (b) lead parado.
 *
 * Cinco consultas em lote, uma decisão pura, uma RPC por tarefa. Falha numa
 * tarefa não para as outras: cada uma tem seu try.
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

  // Só o follow-up ligado: só "Em contato" interessa. Em Novo, o que veio de
  // importação em massa é descartado na decisão (ver ETAPAS_LEAD_PARADO).
  const etapas = cfg.leadParado.ativa ? [...ETAPAS_LEAD_PARADO] : ['em_contato'];
  const leads = exigir<LinhaLead[]>(
    'leads',
    await sb
      .from('leads')
      .select(
        'id, nome, status, dono_id, origem, status_desde, dono:usuarios!leads_dono_id_fkey(ativo)',
      )
      .eq('is_exemplo', false)
      .in('status', etapas),
  );
  r.leadsAnalisados = leads.length;
  if (!leads.length) return r;

  const ids = leads.map((l) => l.id);
  // Só o follow-up olha o WhatsApp, e só de quem está em "Em contato". Com o
  // lead parado ligado entram também leads parados há meses em outras etapas,
  // e a janela de mensagens iria junto até lá atrás sem mudar decisão nenhuma.
  const emContato = cfg.followUp.ativa ? leads.filter((l) => l.status === 'em_contato') : [];
  const [tarefas, conversas, disparos] = await Promise.all([
    sb
      .from('tarefas')
      .select('lead_id')
      .in('lead_id', ids)
      .in('status', ['pendente', 'em_andamento']),
    emContato.length
      ? sb
          .from('whatsapp_conversas')
          .select('id, lead_id')
          .in(
            'lead_id',
            emContato.map((l) => l.id),
          )
      : Promise.resolve({ data: [], error: null }),
    sb
      .from('regras_disparos')
      .select('regra, lead_id, chave_ciclo, created_at')
      .in('lead_id', ids)
      .in('regra', ['follow_up', 'lead_parado']),
  ]);

  const comTarefaAberta = new Set(
    exigir<{ lead_id: string }[]>('tarefas', tarefas).map((t) => t.lead_id),
  );
  const leadDaConversa = new Map(
    exigir<{ id: string; lead_id: string }[]>('whatsapp_conversas', conversas).map((c) => [
      c.id,
      c.lead_id,
    ]),
  );
  const disparosPorLead = new Map<string, DisparoAnterior[]>();
  for (const d of exigir<
    { regra: ChaveRegra; lead_id: string; chave_ciclo: string; created_at: string }[]
  >('regras_disparos', disparos)) {
    const lista = disparosPorLead.get(d.lead_id) ?? [];
    lista.push({ regra: d.regra, chaveCiclo: d.chave_ciclo, criadoEm: d.created_at });
    disparosPorLead.set(d.lead_id, lista);
  }

  // Mensagens: só as RECEBIDAS, a partir da entrada mais antiga na etapa. O
  // resto da conversa não muda decisão nenhuma.
  const ultimaEntrada = new Map<string, string>();
  if (leadDaConversa.size) {
    const desde = new Date(
      Math.min(...emContato.map((l) => Date.parse(l.status_desde))),
    ).toISOString();
    // O PostgREST corta a resposta em 1000 linhas sem dar erro. Com o robô
    // conversando, uma resposta perdida no corte viraria follow-up pra quem
    // respondeu: pagina até o fim. Ordem total (data + id) pra página não
    // repetir nem pular linha.
    type LinhaMsg = { conversa_id: string; direcao: string; created_at: string };
    const msgs: LinhaMsg[] = [];
    for (let de = 0; ; de += PAGINA) {
      const pagina = exigir<LinhaMsg[]>(
        'whatsapp_mensagens',
        await sb
          .from('whatsapp_mensagens')
          .select('conversa_id, direcao, created_at')
          .in('conversa_id', [...leadDaConversa.keys()])
          .eq('direcao', 'entrada')
          .gte('created_at', desde)
          .order('created_at', { ascending: false })
          .order('id')
          .range(de, de + PAGINA - 1),
      );
      msgs.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
    for (const m of msgs) {
      const leadId = leadDaConversa.get(m.conversa_id);
      // O filtro já veio do banco; conferir de novo custa nada e impede que
      // uma mensagem ENVIADA conte como resposta.
      if (!leadId || m.direcao !== 'entrada') continue;
      const atual = ultimaEntrada.get(leadId);
      if (!atual || Date.parse(m.created_at) > Date.parse(atual))
        ultimaEntrada.set(leadId, m.created_at);
    }
  }

  const noCiclo: LeadNoCiclo[] = leads.map((l) => ({
    id: l.id,
    nome: l.nome,
    status: l.status,
    // Dono inativo não lê tarefa: tratar como sem dono manda pra gestão.
    donoId: l.dono_id && l.dono?.ativo ? l.dono_id : null,
    origem: l.origem,
    statusDesde: l.status_desde,
    temTarefaAberta: comTarefaAberta.has(l.id),
    ultimaEntradaWhatsapp: ultimaEntrada.get(l.id) ?? null,
    disparos: disparosPorLead.get(l.id) ?? [],
  }));

  for (const acao of decidirRegrasDeLead(noCiclo, cfg, agora)) {
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
