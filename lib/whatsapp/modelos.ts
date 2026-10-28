import { maskCNJ } from '@/lib/masks';

/**
 * Os modelos aprovados pela Meta pra primeira mensagem fria — a única forma
 * de a RGT escrever primeiro pra alguém (fora da janela de 24h, só modelo).
 *
 * O texto aqui é cópia do que foi submetido em 28/10 (lido da API da Meta,
 * não reescrito). Serve pra registrar no histórico exatamente o que a pessoa
 * recebeu: a Meta monta a mensagem do lado dela, e o log é a prova da RGT.
 * Se mudar o modelo na Meta, mude aqui também.
 *
 * Decisão do Renato (28/10): abordar credores e advogados. Onde há advogado
 * nos autos, o advogado primeiro; o credor direto só sem advogado ou sem
 * resposta dele.
 */

export type Destino = 'credor' | 'advogado';

export interface ModeloWhatsapp {
  nome: string;
  idioma: string;
  /** {{1}} quem recebe, {{2}} o broker, {{3}} o número do processo. */
  corpo: string;
  rodape: string;
  /**
   * O robô assume a resposta? Com advogado, não: ele vai perguntar valor na
   * primeira resposta, e isso o robô não responde. A conversa nasce parada,
   * com o broker.
   */
  robo: boolean;
}

export const MODELOS: Record<Destino, ModeloWhatsapp> = {
  credor: {
    nome: 'rgt_proposta_credor',
    idioma: 'pt_BR',
    corpo:
      'Olá, {{1}}. Aqui é {{2}}, da RGT Capital, empresa de Maceió que antecipa precatórios.\n\nVimos no Diário de Justiça que o processo {{3}} teve ofício requisitório expedido em seu nome.\n\nSe quiser entender como funciona receber antes da fila, é só responder esta mensagem. Sem compromisso, e sem custo nenhum pra conversar.',
    rodape: 'RGT Capital - Maceio/AL',
    robo: true,
  },
  advogado: {
    nome: 'rgt_proposta_advogado',
    idioma: 'pt_BR',
    corpo:
      'Olá, Dr(a). {{1}}. Aqui é {{2}}, da RGT Capital, empresa de Maceió que trabalha com cessão de precatórios.\n\nLocalizamos no Diário de Justiça o ofício requisitório do processo {{3}}, em que o senhor(a) atua.\n\nGostaríamos de apresentar uma proposta de cessão ao seu cliente, por seu intermédio. Posso enviar os detalhes?',
    rodape: 'RGT Capital - Maceio/AL',
    robo: false,
  },
};

export function variaveisDoModelo(input: {
  nomeDestinatario: string;
  nomeBroker: string;
  numeroProcesso: string;
}): [string, string, string] {
  return [
    input.nomeDestinatario.trim(),
    // Primeiro nome: "Aqui é Robson, da RGT" — o nome completo soa a robô.
    input.nomeBroker.trim().split(/\s+/)[0] ?? input.nomeBroker,
    maskCNJ(input.numeroProcesso.replace(/\D/g, '')),
  ];
}

export function montarTextoModelo(destino: Destino, vars: readonly string[]): string {
  return MODELOS[destino].corpo.replace(/\{\{(\d)\}\}/g, (_, n) => vars[Number(n) - 1] ?? '');
}

/**
 * Telefone da planilha → formato da Meta (só dígitos, com 55). Devolve null
 * quando não dá pra ter certeza de que é um celular brasileiro: mandar modelo
 * pro número errado gasta a mensagem e abre conversa com um desconhecido.
 */
export function telefoneParaEnvio(bruto: string | null | undefined): string | null {
  let d = (bruto ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (!/^[1-9][1-9]/.test(d)) return null;
  // Celular: 11 dígitos começando com 9 depois do DDD. Fixo não tem WhatsApp
  // na prática, e 10 dígitos sem o 9 costuma ser celular antigo mal digitado.
  if (d.length !== 11 || d[2] !== '9') return null;
  return `55${d}`;
}
