import { hojeEmSaoPaulo } from '@/lib/datas';
import { labelStatus } from '@/lib/leads';
import { maskCNJ } from '@/lib/masks';
import type { Publicacao } from '@/lib/djen/types';
// A mesma trava do disparo (disparo-actions.ts): a tarefa diz a verdade sobre
// quando o botão do número da RGT volta a aceitar o modelo.
import { INTERVALO_MINIMO_DIAS_MODELO } from '@/lib/whatsapp/modelos';

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
export function chaveReavaliar(leadId: string, perdidoDesde: string): string {
  return `reavaliar_perdido:${leadId}:${instante(perdidoDesde)}`;
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
}

export interface LeadNoCiclo {
  id: string;
  nome: string;
  status: string;
  /** null se o lead não tem dono ou se o dono está inativo. */
  donoId: string | null;
  statusDesde: string;
  /** Tarefa pendente ou em andamento, de qualquer origem. */
  temTarefaAberta: boolean;
  /** Última mensagem RECEBIDA no WhatsApp da RGT, em qualquer conversa do lead. */
  ultimaEntradaWhatsapp: string | null;
  /** Último modelo que saiu pelo número da RGT pra este lead. */
  ultimoModeloEm: string | null;
  disparos: DisparoAnterior[];
}

/** O que dizer sobre o botão do número da RGT, respeitando a trava de 7 dias. */
export function linhaDoModelo(ultimoModeloEm: string | null, agora: Date): string {
  const botao = 'botão “Abordar pelo WhatsApp da RGT”, no card';
  if (!ultimoModeloEm) {
    return `Você também pode mandar o modelo pelo número da RGT (${botao}).`;
  }
  const saiu = Date.parse(ultimoModeloEm);
  const libera = saiu + INTERVALO_MINIMO_DIAS_MODELO * DIA;
  if (agora.getTime() < libera) {
    return `Pelo número da RGT ainda não dá: o modelo saiu em ${fmtDiaMes(saiu)} e só pode ser reenviado a partir de ${fmtDiaMes(libera)}.`;
  }
  return `Pelo número da RGT, o modelo já pode ser reenviado (${botao}).`;
}

function decidirFollowUp(
  lead: LeadNoCiclo,
  cfg: ConfigRegras['followUp'],
  agora: Date,
): TarefaDeRegra | null {
  if (!cfg.ativa || lead.status !== 'em_contato' || lead.temTarefaAberta) return null;

  const desde = Date.parse(lead.statusDesde);
  // Só conta resposta que veio DEPOIS de o lead entrar em "Em contato": quem
  // escreveu antes e depois foi abordado continua sem responder à abordagem.
  if (lead.ultimaEntradaWhatsapp && Date.parse(lead.ultimaEntradaWhatsapp) > desde) return null;

  const prefixo = prefixoFollowUp(lead.id, lead.statusDesde);
  const anteriores = lead.disparos.filter(
    (d) => d.regra === 'follow_up' && d.chaveCiclo.startsWith(prefixo),
  );
  const n = anteriores.length;
  if (n >= cfg.maxTentativas) return null;

  // A 2ª tentativa conta a partir da 1ª, não da entrada na etapa: sem isso
  // ela sairia no dia seguinte ao fechamento da primeira.
  const referencia = n ? Math.max(...anteriores.map((d) => Date.parse(d.criadoEm))) : desde;
  if (agora.getTime() - referencia < cfg.dias * DIA) return null;

  const k = n + 1;
  const M = cfg.maxTentativas;
  const ultima = k === M;
  const dias = Math.floor((agora.getTime() - desde) / DIA);
  const ha = plural(dias, 'dia', 'dias');

  const descricao = [
    `${lead.nome} está em Em contato desde ${fmtDiaMes(desde)} e não há resposta registrada no WhatsApp da RGT.`,
    'O que fazer: ligue, ou mande do seu WhatsApp a mensagem de retomada (ícone verde no card do lead).',
    linhaDoModelo(lead.ultimoModeloEm, agora),
    'Se a pessoa já respondeu por outro canal, mude a etapa do lead e conclua esta tarefa.',
    ...(ultima
      ? [
          'Esta é a última tentativa automática: depois dela o sistema não cria mais follow-up para este lead. Se continuar sem resposta, marque como perdido ou agende um retorno.',
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

const DICA_POR_ETAPA: Record<(typeof ETAPAS_ATIVAS)[number], string> = {
  novo: 'Defina quem cuida dele e faça o primeiro contato.',
  em_contato: 'Tente outro canal (ligação, advogado) ou decida se ainda vale insistir.',
  qualificado: 'Monte a proposta e envie.',
  proposta_enviada: 'Pergunte se a pessoa decidiu e tire as dúvidas sobre a proposta.',
};

function ehEtapaAtiva(status: string): status is (typeof ETAPAS_ATIVAS)[number] {
  return (ETAPAS_ATIVAS as readonly string[]).includes(status);
}

function decidirParado(
  lead: LeadNoCiclo,
  cfg: ConfigRegras['leadParado'],
  agora: Date,
): TarefaDeRegra | null {
  if (!cfg.ativa || !ehEtapaAtiva(lead.status) || lead.temTarefaAberta) return null;

  const desde = Date.parse(lead.statusDesde);
  if (agora.getTime() - desde < cfg.dias * DIA) return null;

  // "Uma vez por entrada na etapa" sai da própria chave: mudou de etapa, o
  // status_desde muda e a chave também.
  const chave = chaveParado(lead.id, lead.status, lead.statusDesde);
  if (lead.disparos.some((d) => d.regra === 'lead_parado' && d.chaveCiclo === chave)) return null;

  const etapa = labelStatus(lead.status);
  const ha = plural(Math.floor((agora.getTime() - desde) / DIA), 'dia', 'dias');

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
    titulo: `Lead parado há ${ha} em ${etapa}`,
    descricao: `${lead.nome} está em ${etapa} desde ${fmtDiaMes(desde)} sem mudar de etapa. ${DICA_POR_ETAPA[lead.status]} Se não houver mais chance, marque como perdido. Este aviso sai uma vez por etapa.`,
    prazo: hojeEmSaoPaulo(agora),
  };
}

/**
 * Uma rodada das regras (a) e (b). No máximo UMA tarefa por lead por rodada,
 * com o follow-up na frente: duas tarefas de uma vez pro mesmo lead seriam
 * duas formas de dizer a mesma coisa. O parado espera a do follow-up fechar.
 */
export function decidirRegrasDeLead(
  leads: readonly LeadNoCiclo[],
  cfg: ConfigRegras,
  agora: Date,
): TarefaDeRegra[] {
  const acoes: TarefaDeRegra[] = [];
  for (const lead of leads) {
    const acao =
      decidirFollowUp(lead, cfg.followUp, agora) ?? decidirParado(lead, cfg.leadParado, agora);
    if (acao) acoes.push(acao);
  }
  return acoes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Regra (c): o processo andou no Diário
// ─────────────────────────────────────────────────────────────────────────────

export type PublicacaoDaRegra = Pick<Publicacao, 'id' | 'dataDisponibilizacao' | 'redFlags'>;

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
 *    Se a regra já tem tarefa aberta pra esse alvo, não empilha outra: em
 *    processo movimentado sairia uma por dia.
 *  - Lead perdido "sem ofício" → só a tarefa de reavaliar, e só quando o
 *    Diário mostra ofício expedido (X1) depois da perda. Olha também a linha
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
    prazo: hoje,
  };

  if (alvo.perdidoDesde) {
    // Dia de São Paulo em que virou Perdido: a data do DJEN é dia de calendário.
    const corte = hojeEmSaoPaulo(new Date(alvo.perdidoDesde));
    const comOficio = ctx.todas.filter(
      (p) => p.dataDisponibilizacao >= corte && p.redFlags.some((f) => f.codigo === 'X1'),
    );
    if (!comOficio.length) return null;
    const data = comOficio.reduce(
      (a, p) => (p.dataDisponibilizacao > a ? p.dataDisponibilizacao : a),
      '',
    );
    return {
      ...base,
      chaveCiclo: chaveReavaliar(alvo.id, alvo.perdidoDesde),
      motivo: `Perdido sem ofício; ofício expedido no Diário de ${fmtDataIso(data)}`,
      titulo: 'Reavaliar lead perdido: saiu o ofício',
      descricao: `${alvo.nome} foi marcado como perdido porque ainda não tinha ofício requisitório. O Diário de ${fmtDataIso(data)} mostra ofício expedido no processo ${maskCNJ(alvo.cnj)}. O lead continua em Perdido. Se valer a pena, arraste o card de volta para uma etapa ativa e retome o contato.`,
    };
  }

  if (!ctx.jaVisto || !ctx.novas.length || ctx.temTarefaAbertaDaRegra) return null;

  const maiorId = Math.max(...ctx.novas.map((p) => p.id));
  const maisRecente = ctx.novas.reduce(
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
    descricao: `${resumo.descricao}\nLeia a publicação, veja se muda a negociação e anote ${onde}. Se for pagamento, cessão ou penhora, avise a gestão hoje.`,
  };
}
