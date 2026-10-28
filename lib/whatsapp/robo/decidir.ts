import { avaliarGuardrails, type ContextoConversa, type MotivoGatilho } from '../guardrails';
import type { AutorMensagem } from '../conversas';
import { verificarSaida } from './freio-saida';
import { coletaCompleta, type DadosColetados, type DecisaoRobo } from './schema';

/**
 * O cérebro do robô, sem banco e sem WhatsApp: recebe a conversa e devolve um
 * PLANO do que fazer. Quem executa (gravar, enviar, pausar) é outro módulo.
 *
 * Separado assim pra ser testável sem gastar dinheiro: a IA entra como função
 * injetada, e o teste passa uma IA falsa que responde o que ele quiser —
 * inclusive o pior caso, uma IA que escorrega e fala preço.
 *
 * A ordem é a regra de segurança inteira:
 *   1. freio de entrada — se disparar, a IA nem é chamada
 *   2. IA
 *   3. freio de saída — se disparar, o texto da IA não sai
 */

export interface MensagemHistorico {
  autor: AutorMensagem;
  conteudo: string;
}

/** O que a RGT já sabe e o robô apresenta pra confirmar. Nunca pergunta. */
export interface ProcessoConhecido {
  credor: string | null;
  tribunal: string | null;
  ente_devedor: string | null;
  numero_processo: string | null;
}

export interface EntradaRobo {
  /** A conversa até agora. A última é a mensagem da pessoa que chegou. */
  historico: MensagemHistorico[];
  ctx: ContextoConversa;
  processo: ProcessoConhecido | null;
}

export type ChamarIA = (entrada: EntradaRobo) => Promise<DecisaoRobo>;

export interface PlanoRobo {
  /** O que mandar pra pessoa. `null`: não manda nada. */
  enviar: string | null;
  /** Para o robô e põe na fila do broker. */
  pausar: { motivo: string; urgente: boolean } | null;
  /** Grava em `whatsapp_optout`: nunca mais, nem do broker. */
  optout: boolean;
  /** Dados confirmados até aqui, quando a IA rodou. */
  dados: DadosColetados | null;
  /** O freio recusou preço agora: a próxima insistência escala. */
  recusouPreco: boolean;
  /** A IA não entendeu: soma no contador de incompreensão. */
  naoEntendeu: boolean;
  /** Quem decidiu. Vai pro log e pra tela do simulador. */
  fonte: 'freio_entrada' | 'ia' | 'freio_saida' | 'erro_ia';
  /** `midia`: áudio, foto ou documento — o robô não lê, passa pro broker. */
  gatilho: MotivoGatilho | 'midia' | null;
}

/**
 * Textos fixos de passagem. Fixos porque saem em momento delicado — luto,
 * acusação, golpe em andamento — e não é hora de a IA improvisar.
 */
const PASSAGEM_PADRAO =
  'Vou chamar uma pessoa da nossa equipe pra continuar essa conversa com você. Ela responde por aqui mesmo.';

const PASSAGEM_POR_MOTIVO: Partial<Record<MotivoGatilho, string>> = {
  optout: 'Tudo bem. Não vamos mais mandar mensagem. Se um dia mudar de ideia, é só escrever aqui.',
  possivel_golpe_em_andamento:
    'Isso é importante: ninguém precisa pagar nada pra vender um precatório. Vou chamar agora uma pessoa da nossa equipe pra conversar com você sobre isso.',
  obito:
    'Sinto muito. Vou pedir pra uma pessoa da nossa equipe continuar essa conversa com você, com calma. Ela responde por aqui mesmo.',
  emocional:
    'Sinto muito por isso. Vou pedir pra uma pessoa da nossa equipe continuar com você, com calma. Ela responde por aqui mesmo.',
  pergunta_juridica:
    'Essa é uma pergunta importante, e eu não quero te dar uma resposta errada. Vou passar pra uma pessoa da nossa equipe, que responde por aqui mesmo.',
  pediu_humano: 'Claro. Vou chamar uma pessoa da nossa equipe, que responde por aqui mesmo.',
};

function passagem(motivo: MotivoGatilho | null): string {
  return (motivo && PASSAGEM_POR_MOTIVO[motivo]) ?? PASSAGEM_PADRAO;
}

const VAZIO: Omit<PlanoRobo, 'fonte'> = {
  enviar: null,
  pausar: null,
  optout: false,
  dados: null,
  recusouPreco: false,
  naoEntendeu: false,
  gatilho: null,
};

export async function decidirProximoPasso(
  entrada: EntradaRobo,
  chamarIA: ChamarIA,
): Promise<PlanoRobo> {
  const ultima = entrada.historico.at(-1);
  const textoRecebido = ultima?.autor === 'contato' ? ultima.conteudo : '';
  const tipo = entrada.ctx.tipoMensagem;
  const midia = Boolean(tipo && tipo !== 'texto');

  // 1. Freio de entrada. Vale também pra legenda de foto: "SAIR" escrito
  // embaixo de uma imagem ainda é opt-out.
  const g = avaliarGuardrails(textoRecebido, entrada.ctx);
  if (g && g.motivo !== 'coleta_completa') {
    if (g.acao === 'responder_e_seguir' && !midia) {
      return {
        ...VAZIO,
        fonte: 'freio_entrada',
        gatilho: g.motivo,
        enviar: g.resposta ?? null,
        recusouPreco: g.motivo === 'preco',
      };
    }
    if (g.acao !== 'responder_e_seguir') {
      return {
        ...VAZIO,
        fonte: 'freio_entrada',
        gatilho: g.motivo,
        enviar: passagem(g.motivo),
        pausar: { motivo: g.explicacao, urgente: g.urgente },
        optout: g.acao === 'encerrar',
      };
    }
  }

  // Áudio, foto ou documento: o robô ainda não ouve nem lê. Passa sem dizer
  // "não consigo ouvir áudio" — a pesquisa proíbe, soa a robô quebrado. O
  // broker vê o motivo e decide se liga ou responde. Transcrever áudio é
  // decisão em aberto; quando vier, é aqui que muda.
  if (midia) {
    const nome = { audio: 'um áudio', imagem: 'uma foto', documento: 'um documento' }[
      tipo as 'audio' | 'imagem' | 'documento'
    ];
    return {
      ...VAZIO,
      fonte: 'freio_entrada',
      gatilho: 'midia',
      enviar: PASSAGEM_PADRAO,
      pausar: {
        motivo: `A pessoa mandou ${nome ?? 'uma mídia'}. O robô não ouve áudio nem lê foto — abra e responda, ou ligue.`,
        urgente: false,
      },
    };
  }

  // 2. IA. Qualquer falha — rede, recusa, formato — vira passagem: a pessoa
  // não fica sem resposta e o broker sabe por quê.
  let decisao: DecisaoRobo;
  try {
    decisao = await chamarIA(entrada);
  } catch (e) {
    return {
      ...VAZIO,
      fonte: 'erro_ia',
      enviar: PASSAGEM_PADRAO,
      pausar: {
        motivo: `O robô não conseguiu responder (${e instanceof Error ? e.message : 'erro desconhecido'}). Assuma a conversa.`,
        urgente: false,
      },
    };
  }

  // 3. Freio de saída. Barrou: o texto da IA não sai, nem pedaço dele.
  const freio = verificarSaida(decisao.resposta);
  if (!freio.ok) {
    return {
      ...VAZIO,
      fonte: 'freio_saida',
      dados: decisao.dados,
      enviar: PASSAGEM_PADRAO,
      pausar: {
        motivo: `A resposta da IA foi barrada antes de sair: ${freio.motivo}. Assuma a conversa.`,
        urgente: false,
      },
    };
  }

  const plano: PlanoRobo = {
    ...VAZIO,
    fonte: 'ia',
    dados: decisao.dados,
    enviar: decisao.resposta,
    naoEntendeu: !decisao.entendeu,
  };

  if (decisao.passar_para_humano) {
    plano.pausar = {
      motivo: decisao.motivo_passagem ?? 'O robô passou a conversa pra equipe.',
      urgente: false,
    };
  } else if (coletaCompleta(decisao.dados)) {
    // A IA coletou tudo mas não marcou a passagem: o código passa por ela.
    // O roteiro é explícito que o robô não "continua a relação".
    plano.pausar = {
      motivo: 'Todos os campos obrigatórios foram confirmados. O robô cumpriu a função.',
      urgente: false,
    };
    plano.gatilho = 'coleta_completa';
  }

  return plano;
}
