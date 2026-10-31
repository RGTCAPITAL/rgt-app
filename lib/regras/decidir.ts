import { hojeEmSaoPaulo, proximoDiaUtil, somarDias } from '@/lib/datas';
import { labelStatus } from '@/lib/leads';
import { maskCNJ } from '@/lib/masks';
import type { Publicacao } from '@/lib/djen/types';

/**
 * As três regras automáticas do CRM, só a decisão: quem recebe tarefa hoje,
 * com qual título e qual texto. Nada aqui lê banco nem relógio — o `agora`
 * entra por parâmetro, pra dar pra testar a virada do dia e as 48h exatas.
 *
 * REGRA QUE ORIENTA O MÓDULO: automação na RGT CRIA TAREFA PARA UMA PESSOA,
 * nunca manda mensagem sozinha. Quem fala com o credor é gente.
 *
 * O banco (migration 048) guarda as chaves liga/desliga e o registro de quem
 * foi atingido; quem grava é lib/regras/executar.ts.
 */

export type ChaveRegra = 'follow_up' | 'lead_parado' | 'processo_andou';

export const NOME_REGRA: Record<ChaveRegra, string> = {
  follow_up: 'Follow-up de lead sem resposta',
  lead_parado: 'Lead parado na etapa',
  processo_andou: 'Processo andou',
};

/** Etapas em que o lead ainda está sendo trabalhado. Ganho e perdido nunca entram. */
export const ETAPAS_ATIVAS = ['novo', 'em_contato', 'qualificado', 'proposta_enviada'] as const;

/**
 * Onde o "lead parado" vale. Em Novo, só pra quem foi cadastrado um a um
 * (site, WhatsApp, indicação, broker): é quem não pode ser esquecido. Quem
 * veio de importação em massa fica de fora — os 378 contatos do Renato
 * entrariam todos em Novo no mesmo dia, e no 7º dia seriam 378 tarefas.
 */
export const ETAPAS_LEAD_PARADO = [
  'novo',
  'em_contato',
  'qualificado',
  'proposta_enviada',
] as const;
/** Origens que só existem por importação em massa (a Prospecção grava lista_processual). */
export const ORIGENS_EM_MASSA: readonly string[] = ['importacao_planilha', 'lista_processual'];
/** Quem chegou procurando a RGT: só pra esses o aviso diz "foi a pessoa que procurou". */
const ORIGENS_QUE_PROCURARAM: readonly string[] = ['site', 'whatsapp'];

/**
 * Teto de tarefas de "lead parado" por pessoa por dia (de São Paulo), as mais
 * antigas primeiro. O resto não é perdido: sem registro, volta no dia
 * seguinte. Por DIA e não por rodada: a Vercel às vezes roda o cron duas
 * vezes, e a segunda rodada entregaria mais 10.
 */
export const MAX_PARADOS_POR_PESSOA_DIA = 10;

/**
 * Faixas aceitas. As mesmas do CHECK da 048: o formulário, a action e o banco
 * recusam o mesmo valor, e ninguém descobre o limite só no erro do Postgres.
 */
export const LIMITES = {
  followUpDias: { min: 1, max: 30 },
  followUpMaxTentativas: { min: 1, max: 5 },
  leadParadoDias: { min: 1, max: 90 },
} as const;

const HORA = 3_600_000;
const DIA = 24 * HORA;

// ─────────────────────────────────────────────────────────────────────────────
// Configuração
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigRegras {
  /** `valida: false` = o parâmetro no banco não fecha; a regra conta como desligada. */
  followUp: { ativa: boolean; dias: number; maxTentativas: number; valida: boolean };
  leadParado: { ativa: boolean; dias: number; valida: boolean };
  processoAndou: { ativa: boolean; valida: boolean };
}

export interface LinhaRegra {
  chave: string;
  ativa: boolean;
  parametros: unknown;
}

/** Os valores com que as regras nascem na 048. Usados quando o banco não fecha. */
export const PADRAO = { followUpDias: 2, followUpMaxTentativas: 2, leadParadoDias: 7 } as const;

export const TUDO_DESLIGADO: ConfigRegras = {
  followUp: {
    ativa: false,
    dias: PADRAO.followUpDias,
    maxTentativas: PADRAO.followUpMaxTentativas,
    valida: true,
  },
  leadParado: { ativa: false, dias: PADRAO.leadParadoDias, valida: true },
  processoAndou: { ativa: false, valida: true },
};

function inteiroNaFaixa(v: unknown, faixa: { min: number; max: number }): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= faixa.min && v <= faixa.max
    ? v
    : null;
}

/**
 * Linhas de `regras_automaticas` → configuração. Falha fechada: linha que
 * falta ou parâmetro que não fecha conta como regra DESLIGADA. Uma regra que
 * roda com "dias: 0" criaria tarefa todo dia pra todo mundo.
 */
export function lerConfig(linhas: readonly LinhaRegra[]): ConfigRegras {
  const por = new Map(linhas.map((l) => [l.chave, l]));
  const params = (chave: string): Record<string, unknown> => {
    const p = por.get(chave)?.parametros;
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  };

  const fu = por.get('follow_up');
  const fuDias = inteiroNaFaixa(params('follow_up').dias, LIMITES.followUpDias);
  const fuMax = inteiroNaFaixa(params('follow_up').max_tentativas, LIMITES.followUpMaxTentativas);
  const fuValida = Boolean(fu) && fuDias !== null && fuMax !== null;

  const lp = por.get('lead_parado');
  const lpDias = inteiroNaFaixa(params('lead_parado').dias, LIMITES.leadParadoDias);
  const lpValida = Boolean(lp) && lpDias !== null;

  const pa = por.get('processo_andou');

  return {
    followUp: {
      ativa: fuValida && fu!.ativa === true,
      dias: fuDias ?? PADRAO.followUpDias,
      maxTentativas: fuMax ?? PADRAO.followUpMaxTentativas,
      valida: fuValida,
    },
    leadParado: {
      ativa: lpValida && lp!.ativa === true,
      dias: lpDias ?? PADRAO.leadParadoDias,
      valida: lpValida,
    },
    processoAndou: { ativa: Boolean(pa) && pa!.ativa === true, valida: Boolean(pa) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// O que sai de uma decisão
// ─────────────────────────────────────────────────────────────────────────────

export interface TarefaDeRegra {
  regra: ChaveRegra;
  chaveCiclo: string;
  tentativa: number;
  /** Em português, pra tela de admin. */
  motivo: string;
  leadId: string | null;
  operacaoId: string | null;
  destinatarioId: string | null;
  /** Sem dono (ou dono inativo), a tarefa vai pra todos da gestão. */
  destinatarioPerfil: 'gestao' | null;
  titulo: string;
  descricao: string;
  /** YYYY-MM-DD, no dia de São Paulo. */
  prazo: string;
}

/**
 * Instante normalizado pra compor chave. O PostgREST devolve microssegundos
 * ("…22.123456+00:00") e o JS guarda milissegundos: passar pelos dois lados
 * pelo mesmo Date garante que a chave de hoje é igual à de amanhã.
 */
function instante(iso: string): string {
  return new Date(iso).toISOString();
}

// O formato das chaves fica num lugar só: a trava contra repetição depende
// de a rodada de amanhã montar exatamente o mesmo texto que a de hoje.
export function chaveFollowUp(leadId: string, statusDesde: string, tentativa: number): string {
  return `${prefixoFollowUp(leadId, statusDesde)}${tentativa}`;
}
function prefixoFollowUp(leadId: string, statusDesde: string): string {
  return `follow_up:${leadId}:${instante(statusDesde)}:`;
}
export function chaveParado(leadId: string, status: string, statusDesde: string): string {
  return `lead_parado:${leadId}:${status}:${instante(statusDesde)}`;
}
export function chaveProcesso(tipo: 'lead' | 'operacao', id: string, maiorIdDjen: number): string {
  return `processo_andou:${tipo}:${id}:${maiorIdDjen}`;
}
/**
 * Uma tarefa por DIA de citação de ofício (a data mais recente com X1), não
 * por perda: o primeiro "expeça-se" não pode gastar o aviso do ofício que sai
 * de verdade semanas depois. Pela data e não pelo id porque o DJEN publica
 * cópias do mesmo ato no mesmo dia, às vezes chegando um dia depois.
 */
export function chaveReavaliar(leadId: string, perdidoDesde: string, dataX1: string): string {
  return `reavaliar_perdido:${leadId}:${instante(perdidoDesde)}:${dataX1}`;
}

// Fuso fixo: o cron roda em UTC, e às 22h de Maceió já seria o dia seguinte.
const diaMesSP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
});
const fmtDiaMes = (ms: number) => diaMesSP.format(new Date(ms));

/** '2026-10-27' → '27/10/2026'. Data do DJEN já é dia de calendário. */
function fmtDataIso(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);

// ─────────────────────────────────────────────────────────────────────────────
// Regras (a) e (b): olham os leads
// ─────────────────────────────────────────────────────────────────────────────

export interface DisparoAnterior {
  regra: ChaveRegra;
  chaveCiclo: string;
  criadoEm: string;
  /** Quando a tarefa deste disparo foi concluída (null se aberta ou apagada). */
  concluidoEm?: string | null;
}

export interface LeadNoCiclo {
  id: string;
  nome: string;
  status: string;
  /** null se o lead não tem dono ou se o dono está inativo. */
  donoId: string | null;
  /** De onde o lead veio (ORIGEM_LEAD). */
  origem: string;
  /**
   * Veio de importação de planilha (só a importação grava `vinculo`), seja
   * qual for a origem escolhida no formulário. Não conta em Novo.
   */
  importado: boolean;
  statusDesde: string;
  /** Tem telefone no card: é dele que sai o balão do WhatsApp do broker. */
  temTelefone: boolean;
  /**
   * Tem conversa no WhatsApp da RGT (dele ou do mesmo telefone). Lead sem
   * telefone abordado pelo número do advogado tem conversa e não tem telefone.
   */
  temConversaRgt: boolean;
  /**
   * Tarefa pendente ou em andamento com quem receberia a da regra (o dono, ou
   * a gestão quando não há dono). Tarefa esquecida com um dono antigo não
   * conta: travaria o lead para sempre.
   */
  temTarefaAberta: boolean;
  /** Última mensagem RECEBIDA no WhatsApp da RGT, em qualquer conversa do lead. */
  ultimaEntradaWhatsapp: string | null;
  /**
   * Quando uma PESSOA criou a última tarefa deste lead (retorno agendado,
   * tarefa à mão) — as das regras não contam. É o registro de que houve
   * contato por outro canal.
   */
  ultimaAcaoHumana: string | null;
  /**
   * Último movimento de uma pessoa no lead: tarefa criada ou concluída por
   * alguém, ou tarefa de regra concluída. É daqui que o "lead parado" conta.
   */
  ultimaAtividade: string | null;
  disparos: DisparoAnterior[];
}

/** O instante mais recente entre criação e conclusão do disparo. */
function ultimoMovimento(d: DisparoAnterior): number {
  return Math.max(Date.parse(d.criadoEm), d.concluidoEm ? Date.parse(d.concluidoEm) : 0);
}

/** Dia de São Paulo de um instante: 'YYYY-MM-DD'. */
const diaSP = (ms: number) => hojeEmSaoPaulo(new Date(ms));

/**
 * Já se passaram `dias` dias de CALENDÁRIO (de São Paulo) desde `ms`? Por dia,
 * e não por hora: o cron varia até uma hora e o broker conclui tarefa a
 * qualquer hora. Contando horas, um movimento às 16h de quarta empurrava o
 * "dois dias depois" pra segunda; contando dias, ele cai na sexta.
 */
function passaramDias(ms: number, dias: number, agora: Date): boolean {
  return somarDias(diaSP(ms), dias) <= hojeEmSaoPaulo(agora);
}

/** Dias de calendário de São Paulo entre `ms` e hoje. */
function diasDeCalendario(ms: number, agora: Date): number {
  return Math.round((Date.parse(hojeEmSaoPaulo(agora)) - Date.parse(diaSP(ms))) / DIA);
}

/** Tentativas de follow-up já feitas nesta entrada em "Em contato". */
function followUpsDoCiclo(lead: LeadNoCiclo): DisparoAnterior[] {
  const prefixo = prefixoFollowUp(lead.id, lead.statusDesde);
  return lead.disparos.filter((d) => d.regra === 'follow_up' && d.chaveCiclo.startsWith(prefixo));
}

/**
 * Houve contato depois de o lead entrar na etapa: resposta no WhatsApp da
 * RGT, ou uma pessoa registrou algo (agendou retorno, criou tarefa). O que
 * aconteceu ANTES da entrada não conta: quem escreveu antes e depois foi
 * abordado continua sem responder à abordagem.
 */
function houveContatoNoCiclo(lead: LeadNoCiclo): boolean {
  const desde = Date.parse(lead.statusDesde);
  const depois = (iso: string | null) => !!iso && Date.parse(iso) > desde;
  return depois(lead.ultimaEntradaWhatsapp) || depois(lead.ultimaAcaoHumana);
}

/**
 * O follow-up ainda cuida deste lead: está ligado, há WhatsApp (telefone no
 * card ou conversa com a RGT), não houve contato e as tentativas não
 * acabaram. Só nesse caso o "lead parado" fica quieto em Em contato — quem
 * respondeu e travou, ou esgotou as tentativas, volta pro parado (sem isso o
 * lead mais quente, o que respondeu, nunca mais avisava). Sem telefone e sem
 * conversa o contato é por e-mail, e "sem resposta no WhatsApp" não diz nada:
 * quem cuida é o parado.
 */
function followUpAindaCuida(lead: LeadNoCiclo, cfg: ConfigRegras['followUp']): boolean {
  return (
    cfg.ativa &&
    lead.status === 'em_contato' &&
    (lead.temTelefone || lead.temConversaRgt) &&
    !houveContatoNoCiclo(lead) &&
    followUpsDoCiclo(lead).length < cfg.maxTentativas
  );
}

function decidirFollowUp(
  lead: LeadNoCiclo,
  cfg: ConfigRegras['followUp'],
  agora: Date,
): TarefaDeRegra | null {
  if (!followUpAindaCuida(lead, cfg) || lead.temTarefaAberta) return null;

  const desde = Date.parse(lead.statusDesde);
  const anteriores = followUpsDoCiclo(lead);
  const n = anteriores.length;

  // A 2ª tentativa conta a partir da 1ª — do dia em que ela saiu ou em que
  // foi concluída, o que vier depois —, não da entrada na etapa: sem isso ela
  // sairia no dia seguinte a uma tentativa feita com atraso.
  if (n) {
    if (!passaramDias(Math.max(...anteriores.map(ultimoMovimento)), cfg.dias, agora)) return null;
  } else if (agora.getTime() - desde < cfg.dias * DIA) {
    return null;
  }

  const k = n + 1;
  const M = cfg.maxTentativas;
  const ultima = k === M;
  const dias = Math.floor((agora.getTime() - desde) / DIA);
  const ha = plural(dias, 'dia', 'dias');

  // Nunca sugere reenviar a mensagem de primeiro contato pelo número da RGT:
  // seria a mesma abordagem fria de novo. O follow-up é de uma pessoa —
  // ligação ou mensagem do próprio WhatsApp do broker.
  //
  // "Se respondeu" manda mexer no card (mover ou agendar retorno) porque é o
  // que para o follow-up: só anotar e concluir fazia a próxima tentativa sair
  // dizendo "sem resposta" pra quem respondeu.
  const descricao = [
    `${lead.nome} está na etapa Em contato e, desde ${fmtDiaMes(desde)}, não chegou resposta no WhatsApp da RGT.`,
    // Sem telefone no card não há balão: a mensagem da RGT foi pra outro
    // número (o do advogado, em geral), que fica na tela de Conversas.
    lead.temTelefone
      ? 'O que fazer: ligue, ou mande uma mensagem do seu WhatsApp pelo balão do WhatsApp no card (não pelo aviãozinho, que manda a mensagem da RGT). Ele abre um texto pronto pra você editar.'
      : 'O que fazer: ligue ou escreva do seu WhatsApp para o número que recebeu a mensagem da RGT. Ele está na tela de Conversas; se foi o advogado, fale com ele.',
    'Se a pessoa respondeu por ligação ou pelo seu WhatsApp: mova o card para Qualificado, se ela tem interesse, ou agende um retorno pelo calendário do card. Qualquer um dos dois encerra os follow-ups deste lead. Se você tentou e não conseguiu falar, só conclua esta tarefa.',
    ...(ultima
      ? [
          'Esta é a última tentativa automática: depois dela o sistema não cria mais follow-up para este lead. Se continuar sem resposta e não houver mais chance, marque como perdido.',
        ]
      : []),
  ].join('\n');

  return {
    regra: 'follow_up',
    chaveCiclo: chaveFollowUp(lead.id, lead.statusDesde, k),
    tentativa: k,
    motivo: `Em contato há ${ha}, sem resposta no WhatsApp da RGT (tentativa ${k} de ${M})`,
    leadId: lead.id,
    operacaoId: null,
    destinatarioId: lead.donoId,
    destinatarioPerfil: lead.donoId ? null : 'gestao',
    titulo: ultima
      ? `Último follow-up (${k} de ${M}): sem resposta há ${ha}`
      : `Follow-up ${k} de ${M}: sem resposta há ${ha}`,
    descricao,
    prazo: hojeEmSaoPaulo(agora),
  };
}

const DICA_POR_ETAPA: Record<Exclude<(typeof ETAPAS_LEAD_PARADO)[number], 'novo'>, string> = {
  em_contato: 'Tente outro canal (ligação, advogado) ou decida se ainda vale insistir.',
  qualificado: 'Monte a proposta e envie.',
  proposta_enviada: 'Pergunte se a pessoa decidiu e tire as dúvidas sobre a proposta.',
};

function dicaDoParado(lead: LeadNoCiclo, etapa: (typeof ETAPAS_LEAD_PARADO)[number]): string {
  if (etapa === 'novo') {
    // "Defina quem cuida" só faz sentido pra gestão, que recebe o lead sem
    // dono. Pro dono, mandar definir o dono seria mandar escolher a si mesmo.
    const acao = lead.donoId
      ? 'Faça o primeiro contato'
      : 'Defina quem cuida dele e faça o primeiro contato';
    return ORIGENS_QUE_PROCURARAM.includes(lead.origem)
      ? `${acao}: foi a pessoa que procurou a RGT.`
      : `${acao}.`;
  }
  if (etapa === 'em_contato') {
    const desde = Date.parse(lead.statusDesde);
    const depois = (iso: string | null) => !!iso && Date.parse(iso) > desde;
    // Só a mensagem recebida PROVA que a pessoa respondeu. Um retorno
    // agendado pode ser uma ligação que ninguém atendeu: texto neutro.
    if (depois(lead.ultimaEntradaWhatsapp)) {
      return 'A pessoa respondeu no WhatsApp da RGT: mova o card para a etapa certa (Qualificado, se tem interesse).';
    }
    if (depois(lead.ultimaAcaoHumana)) {
      return 'Já houve retorno registrado nesta etapa: se a pessoa tem interesse, mova o card para Qualificado.';
    }
  }
  return DICA_POR_ETAPA[etapa];
}

function valeLeadParado(status: string): status is (typeof ETAPAS_LEAD_PARADO)[number] {
  return (ETAPAS_LEAD_PARADO as readonly string[]).includes(status);
}

function decidirParado(lead: LeadNoCiclo, regras: ConfigRegras, agora: Date): TarefaDeRegra | null {
  const cfg = regras.leadParado;
  if (!cfg.ativa || !valeLeadParado(lead.status) || lead.temTarefaAberta) return null;
  if (lead.status === 'novo' && (lead.importado || ORIGENS_EM_MASSA.includes(lead.origem))) {
    return null;
  }
  // Enquanto o follow-up cuida do lead, o parado não fala junto: as duas
  // regras dariam três tarefas que se contradizem (dia 2, dia 4, dia 7).
  if (followUpAindaCuida(lead, regras.followUp)) return null;

  const desde = Date.parse(lead.statusDesde);
  // Conta a partir do último movimento: a entrada na etapa, o último
  // follow-up (saída ou conclusão) ou o último movimento de uma pessoa
  // (tarefa criada ou concluída). Sem isso o "parado" saía no dia útil
  // seguinte ao último follow-up (dia 2, dia 4, dia 7), ou no dia seguinte a
  // um retorno de "1 semana" concluído. Em dias de calendário, como o
  // follow-up (ver passaramDias).
  const referencia = Math.max(
    desde,
    ...followUpsDoCiclo(lead).map(ultimoMovimento),
    lead.ultimaAtividade ? Date.parse(lead.ultimaAtividade) : 0,
    lead.ultimaAcaoHumana ? Date.parse(lead.ultimaAcaoHumana) : 0,
  );
  if (!passaramDias(referencia, cfg.dias, agora)) return null;

  // "Uma vez por entrada na etapa" sai da própria chave: mudou de etapa, o
  // status_desde muda e a chave também.
  const chave = chaveParado(lead.id, lead.status, lead.statusDesde);
  if (lead.disparos.some((d) => d.regra === 'lead_parado' && d.chaveCiclo === chave)) return null;

  const etapa = labelStatus(lead.status);
  const ha = plural(diasDeCalendario(desde, agora), 'dia', 'dias');

  return {
    regra: 'lead_parado',
    chaveCiclo: chave,
    tentativa: 1,
    motivo: `Parado há ${ha} em ${etapa}`,
    leadId: lead.id,
    operacaoId: null,
    destinatarioId: lead.donoId,
    destinatarioPerfil: lead.donoId ? null : 'gestao',
    // É o que aparece no card e no sino: tem de se explicar sozinho.
    titulo: `Lead parado há ${ha} na etapa ${etapa}`,
    // "Há pelo menos": pra lead anterior à 048 o relógio começa na migration,
    // então a data de entrada real é desconhecida e mais antiga.
    descricao: `${lead.nome} não avança da etapa ${etapa} há pelo menos ${ha}. ${dicaDoParado(lead, lead.status)} Se não houver mais chance, marque como perdido. Este aviso sai uma vez por etapa.`,
    prazo: hojeEmSaoPaulo(agora),
  };
}

/**
 * Uma rodada das regras (a) e (b). No máximo UMA tarefa por lead por rodada,
 * com o follow-up na frente: duas tarefas de uma vez pro mesmo lead seriam
 * duas formas de dizer a mesma coisa. O parado espera a do follow-up fechar.
 *
 * O "lead parado" tem teto por pessoa por dia (MAX_PARADOS_POR_PESSOA_DIA),
 * os mais antigos primeiro: o resto volta amanhã, sem enxurrada no sino.
 * `jaHoje` traz quantos parados cada pessoa já recebeu hoje (chave: id da
 * pessoa, ou 'gestao'), pra uma segunda rodada no mesmo dia não furar o teto.
 */
export function decidirRegrasDeLead(
  leads: readonly LeadNoCiclo[],
  cfg: ConfigRegras,
  agora: Date,
  jaHoje: ReadonlyMap<string, number> = new Map(),
): TarefaDeRegra[] {
  const acoes: TarefaDeRegra[] = [];
  const parados: { acao: TarefaDeRegra; desde: number }[] = [];
  for (const lead of leads) {
    const followUp = decidirFollowUp(lead, cfg.followUp, agora);
    if (followUp) {
      acoes.push(followUp);
      continue;
    }
    const parado = decidirParado(lead, cfg, agora);
    if (parado) parados.push({ acao: parado, desde: Date.parse(lead.statusDesde) });
  }

  const porPessoa = new Map<string, number>();
  for (const { acao } of parados.sort((a, b) => a.desde - b.desde)) {
    const quem = acao.destinatarioId ?? 'gestao';
    const n = porPessoa.get(quem) ?? jaHoje.get(quem) ?? 0;
    if (n >= MAX_PARADOS_POR_PESSOA_DIA) continue;
    porPessoa.set(quem, n + 1);
    acoes.push(acao);
  }
  return acoes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Regra (c): o processo andou no Diário
// ─────────────────────────────────────────────────────────────────────────────

export type PublicacaoDaRegra = Pick<
  Publicacao,
  'id' | 'dataDisponibilizacao' | 'redFlags' | 'link'
>;

export interface AlvoDaRegraProcesso {
  tipo: 'lead' | 'operacao';
  id: string;
  nome: string;
  /** CNJ com 20 dígitos. */
  cnj: string;
  /** Primeiro responsável ativo (dono; na operação, depois o broker). */
  destinatarioId: string | null;
  /** Só pra lead perdido "sem ofício": quando entrou em Perdido. */
  perdidoDesde?: string;
}

/**
 * A tarefa que a rotina do DJEN cria pra um alvo, ou null.
 *
 *  - Alvo ativo com publicação nova (fora da linha de base) → "ler publicação".
 *    "Nova" é pela DATA, a partir de `corteData`: o DJEN às vezes devolve uma
 *    publicação antiga que ainda não estava salva (entrou como nova uma de
 *    12/11/2025), e ela não é novidade nenhuma. Se a regra já tem tarefa
 *    aberta pra esse alvo, não empilha outra (em processo movimentado sairia
 *    uma por dia), a não ser que a nova seja urgente.
 *  - Lead perdido "sem ofício" → só a tarefa de reavaliar, e só quando o
 *    Diário CITA ofício requisitório (X1) depois da perda. Citar não é
 *    expedir — em ~15 de 25 casos amostrados era "expeça-se" ou pendência —,
 *    então o texto pede pra conferir, não afirma que saiu. Olha também a linha
 *    de base: o ofício pode ter saído antes de o processo entrar no rodízio.
 *    O lead NUNCA é reaberto aqui.
 */
export function decidirTarefaDoProcesso(
  alvo: AlvoDaRegraProcesso,
  ctx: {
    novas: readonly PublicacaoDaRegra[];
    todas: readonly PublicacaoDaRegra[];
    jaVisto: boolean;
    temTarefaAbertaDaRegra: boolean;
    /** YYYY-MM-DD: publicação disponibilizada antes disso não conta como nova. */
    corteData?: string;
  },
  resumo: { descricao: string; urgente: boolean },
  hoje: string,
): TarefaDeRegra | null {
  const base = {
    regra: 'processo_andou' as const,
    tentativa: 1,
    leadId: alvo.tipo === 'lead' ? alvo.id : null,
    operacaoId: alvo.tipo === 'operacao' ? alvo.id : null,
    destinatarioId: alvo.destinatarioId,
    destinatarioPerfil: alvo.destinatarioId ? null : ('gestao' as const),
    // Esta regra roda no cron do DJEN, todo dia: tarefa que nasce no fim de
    // semana vence na segunda, e não amanhece "atrasada".
    prazo: proximoDiaUtil(hoje),
  };

  if (alvo.perdidoDesde) {
    // Dia de São Paulo em que virou Perdido: a data do DJEN é dia de calendário.
    const corte = hojeEmSaoPaulo(new Date(alvo.perdidoDesde));
    const comOficio = ctx.todas.filter(
      (p) => p.dataDisponibilizacao >= corte && p.redFlags.some((f) => f.codigo === 'X1'),
    );
    // Uma tarefa aberta por vez: a próxima citação espera esta fechar.
    if (!comOficio.length || ctx.temTarefaAbertaDaRegra) return null;
    const data = comOficio.reduce(
      (a, p) => (p.dataDisponibilizacao > a ? p.dataDisponibilizacao : a),
      '',
    );
    const links = linksDasPublicacoes(comOficio);
    return {
      ...base,
      chaveCiclo: chaveReavaliar(alvo.id, alvo.perdidoDesde, data),
      motivo: `Perdido sem ofício; o Diário de ${fmtDataIso(data)} cita ofício requisitório`,
      titulo: 'Reavaliar lead perdido: o Diário cita ofício requisitório',
      descricao: [
        `${alvo.nome} foi marcado como perdido porque ainda não tinha ofício requisitório.`,
        `O Diário de ${fmtDataIso(data)} cita ofício requisitório no processo ${maskCNJ(alvo.cnj)}. Citar não quer dizer que foi expedido: pode ser só "expeça-se". Confira no PJe.`,
        ...links,
        'O lead continua em Perdido. Se o ofício saiu e vale a pena, arraste o card de volta para uma etapa ativa e retome o contato. Se ainda não saiu, só conclua esta tarefa: o sistema avisa de novo quando o Diário citar o ofício outra vez. Se saiu mas não vale a pena, arraste o card para outra etapa e marque como perdido de novo, sem a opção do ofício: os avisos param.',
      ].join('\n'),
    };
  }

  const novas = ctx.corteData
    ? ctx.novas.filter((p) => p.dataDisponibilizacao >= ctx.corteData!)
    : ctx.novas;
  if (!ctx.jaVisto || !novas.length) return null;
  // Com uma "Ler publicação" aberta, a publicação comum fica só no aviso do
  // sino (no dia seguinte ela já é conhecida). A urgente — pagamento, cessão,
  // penhora — vira tarefa mesmo assim: esperar a anterior fechar a enterrava.
  if (ctx.temTarefaAbertaDaRegra && !resumo.urgente) return null;

  const maiorId = Math.max(...novas.map((p) => p.id));
  const maisRecente = novas.reduce(
    (a, p) => (p.dataDisponibilizacao > a ? p.dataDisponibilizacao : a),
    '',
  );
  const onde = alvo.tipo === 'lead' ? 'no lead' : 'na operação';
  return {
    ...base,
    chaveCiclo: chaveProcesso(alvo.tipo, alvo.id, maiorId),
    motivo: `Publicação nova no Diário${maisRecente ? ` (${fmtDataIso(maisRecente)})` : ''}`,
    titulo: resumo.urgente
      ? 'URGENTE: ler publicação grave no Diário'
      : 'Ler publicação nova no Diário',
    descricao: [
      `Processo ${maskCNJ(alvo.cnj)}.`,
      resumo.descricao,
      ...linksDasPublicacoes(novas),
      `Leia a publicação, veja se muda a negociação e anote ${onde}. Se for pagamento, cessão ou penhora, avise a gestão hoje.`,
    ].join('\n'),
  };
}

/** Até 3 links, das mais recentes: "Publicação de 27/10/2026: https://…". */
function linksDasPublicacoes(pubs: readonly PublicacaoDaRegra[]): string[] {
  // O DJEN repete o mesmo link em publicações do mesmo dia (1913
  // publicações, 1597 links distintos no banco em 31/10): um por URL.
  const vistos = new Set<string>();
  return [...pubs]
    .filter((p) => p.link && !vistos.has(p.link) && vistos.add(p.link))
    .sort((a, b) => b.dataDisponibilizacao.localeCompare(a.dataDisponibilizacao))
    .slice(0, 3)
    .map((p) => `Publicação de ${fmtDataIso(p.dataDisponibilizacao)}: ${p.link}`);
}
