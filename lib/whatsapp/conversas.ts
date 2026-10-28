/**
 * Regras da tela de conversas que não dependem de banco nem de React.
 *
 * Ficam aqui pra serem testadas: a janela de 24h decide se o broker pode
 * escrever, e a ordem da lista decide o que ele vê primeiro. Errar qualquer uma
 * das duas é invisível no build e só aparece com cliente esperando.
 */

export type AutorMensagem = 'bot' | 'humano' | 'contato';

export interface ConversaResumo {
  id: string;
  status: 'aberta' | 'aguardando_humano' | 'encerrada';
  bot_pausado: boolean;
  /** Última atividade. Mensagem nova na conversa empurra pra cima. */
  ultima_em: string;
  ultima: { autor: AutorMensagem } | null;
}

/**
 * A conversa está parada esperando o broker? Só quando um humano está no
 * comando (robô pausado) E a última palavra foi da pessoa. Robô pausado com a
 * última mensagem saindo da RGT — o contato frio que ainda não respondeu, ou o
 * broker que acabou de responder — está esperando a pessoa, não o broker.
 */
export function esperaBroker(c: ConversaResumo): boolean {
  if (c.status === 'encerrada') return false;
  const humanoNoComando = c.bot_pausado || c.status === 'aguardando_humano';
  return humanoNoComando && c.ultima?.autor === 'contato';
}

export interface EstadoJanela {
  aberta: boolean;
  /** Pronto pra tela: "fecha em 3h", "fecha em 12 min", "fechada". */
  rotulo: string;
  /** Menos de 2h: a tela avisa antes que feche no meio da conversa. */
  fechandoLogo: boolean;
}

const HORA = 60 * 60 * 1000;

/**
 * A janela de 24h do WhatsApp: depois da última mensagem da pessoa, a empresa
 * tem 24h pra responder com texto livre. Fechou, só modelo aprovado pela Meta.
 *
 * `null` é fechada, não aberta: conversa que nunca recebeu mensagem da pessoa
 * (contato frio, só o modelo saiu) não tem janela nenhuma. Tratar como aberta
 * deixaria o broker digitar uma resposta que a Meta vai recusar.
 */
export function estadoJanela(
  expiraEm: string | null | undefined,
  agora: Date = new Date(),
): EstadoJanela {
  if (!expiraEm) return { aberta: false, rotulo: 'ainda não aberta', fechandoLogo: false };

  const restante = new Date(expiraEm).getTime() - agora.getTime();
  if (Number.isNaN(restante) || restante <= 0) {
    return { aberta: false, rotulo: 'fechada', fechandoLogo: false };
  }

  const rotulo =
    restante >= HORA
      ? `fecha em ${Math.floor(restante / HORA)}h`
      : `fecha em ${Math.max(1, Math.floor(restante / 60_000))} min`;

  return { aberta: true, rotulo, fechandoLogo: restante < 2 * HORA };
}

/**
 * Conversa que espera o broker vem primeiro: tem gente do outro lado aguardando
 * resposta. Depois o resto, e encerradas no fim. Dentro de cada grupo, a mais
 * recente em cima.
 */
export function ordenarConversas<T extends ConversaResumo>(conversas: readonly T[]): T[] {
  const peso = (c: ConversaResumo) => {
    if (c.status === 'encerrada') return 2;
    if (esperaBroker(c)) return 0;
    return 1;
  };
  return [...conversas].sort((a, b) => peso(a) - peso(b) || b.ultima_em.localeCompare(a.ultima_em));
}

/** Limite do WhatsApp pra mensagem de texto. */
export const LIMITE_TEXTO_WHATSAPP = 4096;
