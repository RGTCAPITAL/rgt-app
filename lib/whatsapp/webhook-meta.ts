import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Leitura do que a Meta manda no webhook do WhatsApp. Só funções puras: quem
 * grava e responde é o executor.
 *
 * Tolerante de propósito: a Meta manda vários formatos no mesmo endpoint
 * (mensagem, status de entrega, reação, erro) e acrescenta campos sem aviso.
 * O que não reconhecemos é ignorado, não derruba o lote inteiro — uma reação
 * com emoji não pode impedir que a mensagem ao lado seja respondida.
 */

export type TipoRecebido = 'texto' | 'audio' | 'imagem' | 'documento' | 'outro';

export interface MensagemRecebida {
  waMessageId: string;
  /** `wa_id` da Meta, só dígitos. É a chave da conversa. */
  telefone: string;
  nomePerfil: string | null;
  tipo: TipoRecebido;
  /** Texto, legenda de mídia ou o texto do botão tocado. */
  conteudo: string | null;
  midiaId: string | null;
  recebidaEm: string;
  bruto: unknown;
}

export type StatusEntrega = 'enviada' | 'entregue' | 'lida' | 'falhou';

export interface StatusRecebido {
  waMessageId: string;
  status: StatusEntrega;
}

const STATUS_META: Record<string, StatusEntrega> = {
  sent: 'enviada',
  delivered: 'entregue',
  read: 'lida',
  failed: 'falhou',
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function lerMensagem(m: Obj, nomes: Map<string, string>): MensagemRecebida | null {
  const id = str(m.id);
  const de = str(m.from)?.replace(/\D/g, '');
  const ts = Number(m.timestamp);
  if (!id || !de || !Number.isFinite(ts)) return null;

  const tipoMeta = str(m.type);
  let tipo: TipoRecebido = 'outro';
  let conteudo: string | null = null;
  let midiaId: string | null = null;

  switch (tipoMeta) {
    case 'text':
      tipo = 'texto';
      conteudo = str(obj(m.text)?.body);
      break;
    case 'button':
      // Botão de resposta rápida de um modelo aprovado: é texto pra todos os efeitos.
      tipo = 'texto';
      conteudo = str(obj(m.button)?.text);
      break;
    case 'interactive': {
      const i = obj(m.interactive);
      tipo = 'texto';
      conteudo = str(obj(i?.button_reply)?.title) ?? str(obj(i?.list_reply)?.title);
      break;
    }
    case 'audio':
      tipo = 'audio';
      midiaId = str(obj(m.audio)?.id);
      break;
    case 'image':
      tipo = 'imagem';
      midiaId = str(obj(m.image)?.id);
      conteudo = str(obj(m.image)?.caption);
      break;
    case 'document':
      tipo = 'documento';
      midiaId = str(obj(m.document)?.id);
      conteudo = str(obj(m.document)?.caption);
      break;
    case 'reaction':
      // Emoji em cima de uma mensagem. Não é algo a responder.
      return null;
  }

  return {
    waMessageId: id,
    telefone: de,
    nomePerfil: nomes.get(de) ?? null,
    tipo,
    conteudo,
    midiaId,
    recebidaEm: new Date(ts * 1000).toISOString(),
    bruto: m,
  };
}

/**
 * Aviso da Meta sobre um modelo de mensagem (o texto aprovado do contato frio).
 *
 * Sem isto os dois tipos eram descartados em silêncio. O de qualidade é o que
 * importa no meio de uma campanha: quando a Meta pausa um modelo por denúncia
 * ou bloqueio, os envios param e, sem o aviso, ninguém entende por quê.
 */
export interface AvisoModelo {
  modelo: string;
  tipo: 'status' | 'qualidade';
  /** status: APPROVED, REJECTED, PAUSED, DISABLED... qualidade: GREEN, YELLOW, RED. */
  valor: string;
  anterior: string | null;
  motivo: string | null;
}

export function lerWebhook(payload: unknown): {
  mensagens: MensagemRecebida[];
  status: StatusRecebido[];
  modelos: AvisoModelo[];
} {
  const mensagens: MensagemRecebida[] = [];
  const status: StatusRecebido[] = [];
  const modelos: AvisoModelo[] = [];

  for (const entry of arr(obj(payload)?.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const value = obj(obj(change)?.value);
      if (!value) continue;

      const campo = str(obj(change)?.field);
      const modelo = str(value.message_template_name);
      if (campo === 'message_template_status_update' && modelo) {
        const evento = str(value.event);
        if (evento) {
          const motivo = str(value.reason);
          modelos.push({
            modelo,
            tipo: 'status',
            valor: evento,
            anterior: null,
            motivo: motivo === 'NONE' ? null : motivo,
          });
        }
        continue;
      }
      if (campo === 'message_template_quality_update' && modelo) {
        const nova = str(value.new_quality_score);
        if (nova) {
          modelos.push({
            modelo,
            tipo: 'qualidade',
            valor: nova,
            anterior: str(value.previous_quality_score),
            motivo: null,
          });
        }
        continue;
      }

      const nomes = new Map<string, string>();
      for (const c of arr(value.contacts)) {
        const waId = str(obj(c)?.wa_id)?.replace(/\D/g, '');
        const nome = str(obj(obj(c)?.profile)?.name);
        if (waId && nome) nomes.set(waId, nome);
      }

      for (const m of arr(value.messages)) {
        const lida = obj(m) && lerMensagem(obj(m)!, nomes);
        if (lida) mensagens.push(lida);
      }

      for (const s of arr(value.statuses)) {
        const id = str(obj(s)?.id);
        const st = STATUS_META[str(obj(s)?.status) ?? ''];
        if (id && st) status.push({ waMessageId: id, status: st });
      }
    }
  }

  // Em ordem de chegada: a Meta pode agrupar várias mensagens da mesma pessoa.
  mensagens.sort((a, b) => a.recebidaEm.localeCompare(b.recebidaEm));
  return { mensagens, status, modelos };
}

/**
 * Confere que o pacote veio da Meta: HMAC-SHA256 do corpo cru com o segredo
 * do app, no cabeçalho `X-Hub-Signature-256: sha256=<hex>`. Sem isso, qualquer
 * um que descobrisse a URL faria o robô responder o que quisesse.
 *
 * Tem que ser o corpo CRU: re-serializar o JSON muda espaços e acentos, e a
 * assinatura não bate.
 */
export function assinaturaValida(
  corpoCru: string,
  cabecalho: string | null,
  segredo: string,
): boolean {
  if (!cabecalho?.startsWith('sha256=') || !segredo) return false;
  const recebida = Buffer.from(cabecalho.slice('sha256='.length), 'hex');
  const esperada = createHmac('sha256', segredo).update(corpoCru, 'utf8').digest();
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
}

const ORDEM_STATUS: Record<string, number> = { enviando: 0, enviada: 1, entregue: 2, lida: 3 };

/**
 * A Meta não garante a ordem dos avisos: "lida" pode chegar antes de
 * "entregue". Status nunca anda pra trás. Falha sempre vale — uma mensagem
 * pode falhar depois de "enviada".
 */
export function statusAvanca(atual: string | null, novo: StatusEntrega): boolean {
  if (novo === 'falhou') return atual !== 'falhou';
  if (atual === 'falhou') return false;
  return (ORDEM_STATUS[novo] ?? 0) > (ORDEM_STATUS[atual ?? 'enviando'] ?? 0);
}

/**
 * O texto do aviso pro admin, ou `null` quando não há o que fazer.
 *
 * Recusado, pausado, desligado ou qualidade vermelha são urgentes: param o
 * contato frio. Amarelo é o aviso antes do vermelho. Aprovado é a notícia
 * que destrava o envio. "Em análise" e o resto não geram aviso.
 */
export function resumirAvisoModelo(
  a: AvisoModelo,
): { titulo: string; descricao: string; urgente: boolean } | null {
  if (a.tipo === 'status') {
    switch (a.valor) {
      case 'APPROVED':
        return {
          titulo: `Meta aprovou o modelo ${a.modelo}`,
          descricao: 'Já dá pra usar no contato frio.',
          urgente: false,
        };
      case 'REJECTED':
        return {
          titulo: `Meta recusou o modelo ${a.modelo}`,
          descricao: `Motivo: ${a.motivo ?? 'não informado'}. Precisa reescrever e submeter de novo.`,
          urgente: true,
        };
      case 'PAUSED':
      case 'DISABLED':
        return {
          titulo: `Meta ${a.valor === 'PAUSED' ? 'pausou' : 'desligou'} o modelo ${a.modelo}`,
          descricao:
            'Os envios com este modelo param até a Meta liberar. Costuma vir de denúncia ou bloqueio de quem recebeu.',
          urgente: true,
        };
      default:
        return null;
    }
  }

  if (a.valor === 'RED') {
    return {
      titulo: `Qualidade do modelo ${a.modelo} ficou vermelha`,
      descricao:
        'Muita gente bloqueando ou denunciando. A Meta pausa o modelo se continuar — reveja o texto e pra quem está indo.',
      urgente: true,
    };
  }
  if (a.valor === 'YELLOW') {
    return {
      titulo: `Qualidade do modelo ${a.modelo} caiu pra amarela`,
      descricao: 'Primeiro aviso da Meta, antes de pausar. Vale olhar as últimas respostas.',
      urgente: false,
    };
  }
  if (a.valor === 'GREEN' && a.anterior && a.anterior !== 'GREEN') {
    return {
      titulo: `Qualidade do modelo ${a.modelo} voltou pro verde`,
      descricao: 'Sem ação necessária.',
      urgente: false,
    };
  }
  return null;
}
