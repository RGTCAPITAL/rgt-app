/**
 * Gatilhos duros do robô de WhatsApp: as situações em que ele para de conduzir
 * a conversa e passa pra um humano.
 *
 * Por que isso é código e não prompt: a pesquisa de 2026-09-23 fechou nisso
 * como requisito nº4. O caso mais caro é preço — Art. 30 do CDC diz que
 * informação suficientemente precisa vincula o fornecedor. Um robô que diga
 * "normalmente fica em torno de 70%" criou oferta, com um idoso hipossuficiente
 * do outro lado e um juiz de Maceió lendo contra a RGT. Prompt é probabilístico;
 * um `if` não alucina. Então o texto da recusa também sai daqui, pronto, e não
 * é gerado pelo modelo.
 *
 * REGRA DE OURO, da pesquisa: na dúvida, escala. Escalar à toa custa 5 minutos
 * de broker. Errar com um aposentado de 68 anos num mercado com alerta oficial
 * de fraude custa a reputação da RGT. Isso justifica os padrões largos aqui —
 * falso positivo é barato de propósito.
 *
 * O que este módulo NÃO faz: decidir o que o robô responde quando nada dispara.
 * Isso é do modelo. Aqui só mora o freio.
 */

export type MotivoGatilho =
  /** Pediu pra sair. Vira linha em `whatsapp_optout` e encerra pra sempre. */
  | 'optout'
  /** Dinheiro já pago a terceiro: pode ser golpe em andamento com o nome da RGT. */
  | 'possivel_golpe_em_andamento'
  /** Acusação explícita, ou menção a denunciar/polícia/Procon/OAB. */
  | 'acusacao_de_golpe'
  /** Desconfiança sem acusação. O robô segue, mas com roteiro fixo. */
  | 'suspeita_de_golpe'
  /** Titular faleceu: vira espólio/herdeiros, nunca por automação. */
  | 'obito'
  /** Curatela, tutela ou interdição: caso jurídico do Renato. */
  | 'curatela_ou_interdicao'
  | 'pediu_humano'
  /** Idade ≥75 (derivada, nunca perguntada) ou sinal de hipervulnerabilidade. */
  | 'vulnerabilidade'
  /** Quem responde não é o titular. */
  | 'nao_e_o_titular'
  /** Já assinou com outra empresa: cessão anterior pode invalidar tudo. */
  | 'cessao_anterior'
  /** Doença, luto, desespero. Nenhum robô conduz uma conversa dessas. */
  | 'emocional'
  /** Qualquer menção a valor, percentual, deságio, quanto recebo. */
  | 'preco'
  /** Pergunta jurídica real: imposto, cartório, vender parte, meação. */
  | 'pergunta_juridica'
  /** Áudio longo ou carregado. O robô nunca manda áudio, e não conduz este. */
  | 'audio_longo'
  /** Não entendeu duas mensagens seguidas. Não existe terceira tentativa. */
  | 'nao_entendeu'
  /** Caminho feliz: coletou tudo e sai de cena. */
  | 'coleta_completa';

export type AcaoGatilho =
  /** Encerra a conversa de vez. Só o opt-out faz isso. */
  | 'encerrar'
  /** Para o robô e põe a conversa na fila do humano. */
  | 'escalar'
  /** O robô responde o texto fixo e continua. Na reincidência, escala. */
  | 'responder_e_seguir';

export interface Gatilho {
  motivo: MotivoGatilho;
  acao: AcaoGatilho;
  /** Avisa o Renato na hora, não só põe na fila. */
  urgente: boolean;
  /** Vai pro `pausado_motivo` e pra tela do broker — ele precisa saber por quê. */
  explicacao: string;
  /** O que casou, pro broker conferir em vez de confiar cego. */
  trecho: string;
  /**
   * Texto que o robô manda, quando a ação prevê resposta. Fixo de propósito:
   * em preço e em acusação de fraude, o modelo não escreve.
   */
  resposta?: string;
}

export interface ContextoConversa {
  /**
   * Quantas vezes o robô já recusou falar preço nesta conversa. A pesquisa pede
   * recusa **uma** vez; se insistir, escala.
   */
  recusasDePreco?: number;
  /**
   * Idade do titular, derivada da data de nascimento que já veio da pesquisa
   * processual. Nunca perguntada — perguntar idade a um idoso numa abordagem
   * comercial é o oposto do que queremos parecer.
   */
  idadeTitular?: number | null;
  /** Mensagens seguidas que o robô não entendeu. */
  naoEntendidasSeguidas?: number;
  tipoMensagem?: 'texto' | 'audio' | 'imagem' | 'documento' | 'outro';
  duracaoAudioSegundos?: number;
  /** Todos os campos obrigatórios do roteiro foram confirmados. */
  camposObrigatoriosCompletos?: boolean;
}

/**
 * A recusa de preço, palavra por palavra como está no roteiro aprovado. Ela diz
 * "não tenho autorização" em vez de "vou verificar": a segunda cria expectativa
 * de número, e expectativa de número é o que o Art. 30 pune.
 *
 * O terceiro parágrafo é contraintuitivo em vendas e essencial aqui — admitir
 * que o valor à vista é menor que o cheio é o que separa a RGT do golpista, que
 * promete o valor integral.
 */
export const RESPOSTA_RECUSA_PRECO = [
  'Essa é a pergunta certa, e eu não vou fingir que sei.',
  'Eu sou o robô da triagem — eu não calculo valor e não tenho autorização pra dizer número nenhum. Quem faz o cálculo é um analista aqui, olhando o seu processo, o valor atualizado e o ano previsto pra pagamento.',
  'Vou ser honesto numa coisa: o valor à vista é menor que o valor cheio do precatório. Sempre. Quem prometer pagar o valor cheio hoje está mentindo. A diferença existe porque a gente vai esperar anos no seu lugar.',
].join('\n\n');

/**
 * Desconfiança não se responde com defesa. Quem diz "não somos golpe" é
 * golpista. Então o robô valida a desconfiança, explica de onde veio o dado e
 * entrega verificação que não depende dele.
 */
export const RESPOSTA_SUSPEITA_GOLPE = [
  'O senhor está certo em desconfiar. Eu também desconfiaria.',
  'Não precisa acreditar em mim: confira o CNPJ da RGT Capital no site da Receita Federal, e pergunte ao advogado do seu processo. Ele consegue confirmar tudo que eu disse.',
  'E uma coisa importante: ninguém precisa pagar nada pra vender um precatório. Se alguém te cobrar taxa, é golpe — inclusive se usarem o nome da RGT.',
].join('\n\n');

/**
 * Casa o padrão só em início de palavra, entendendo acento.
 *
 * Por que não `\b`: no JavaScript ele é ASCII. Não enxerga fronteira antes de
 * "ó" nem depois de "ô", então `\b[óo]bito` falha em "óbito" e `robô\b` falha
 * em "é robô?". E fronteira no fim também não serve: os padrões usam radical de
 * propósito ("filh" pra filho/filha, "advogad" pra advogado/advogada), e `\b`
 * depois do radical nunca casa. Os dois bugs passaram despercebidos até o teste.
 */
function palavra(re: RegExp): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${re.source})`, 'iu');
}

interface Regra {
  motivo: MotivoGatilho;
  acao: AcaoGatilho;
  urgente?: boolean;
  explicacao: string;
  re: RegExp;
  resposta?: string;
}

/**
 * Ordem é prioridade: a primeira regra que casar vence. As de dever legal e de
 * risco à pessoa vêm antes das comerciais — se a mensagem é
 * "paguei uma taxa de 3 mil, quanto vocês pagam?", o que importa é a taxa.
 */
const REGRAS: Regra[] = [
  // --- Dever legal: pediu pra sair --------------------------------------
  // Exige fórmula de saída, e não um "não quero" solto. "Não quero vender"
  // é resposta sobre interesse, não pedido de descadastro: tratar como
  // opt-out apagaria um lead legítimo pra sempre, e o opt-out não tem volta.
  {
    motivo: 'optout',
    acao: 'encerrar',
    explicacao:
      'A pessoa pediu pra não ser mais contatada. Vale pra sempre, inclusive pro broker humano.',
    re: palavra(
      /^\s*(sair|parar|pare|para|stop|chega)\s*[.!]?\s*$|(n[ãa]o quero mais|n[ãa]o me (mande|manda|mandem|procure|procurem)|para de me (mandar|chamar|ligar)|me (tira|tire|remova|remove) da lista|descadastr|sai do meu (zap|whatsapp)|me deixa em paz)/,
    ),
  },

  // --- Risco à pessoa ---------------------------------------------------
  // Taxa cobrada é o golpe clássico do setor. Pode haver uso indevido do nome
  // da RGT, e aí não é só este lead que está em jogo.
  {
    motivo: 'possivel_golpe_em_andamento',
    acao: 'escalar',
    urgente: true,
    explicacao:
      'A pessoa mencionou dinheiro já pago a terceiro. Pode ser vítima de golpe em andamento, possivelmente com uso indevido do nome da RGT. Avisar o Renato.',
    re: palavra(
      /(paguei|pagamos|pagou|depositei|depositou|dep[óo]sito|transferi|transferiu|fiz um pix|mandei um pix|me cobraram|cobraram (uma )?taxa|taxa de (libera[çc][ãa]o|cadastro|honor[áa]rio)|adiantei)/,
    ),
  },
  {
    motivo: 'acusacao_de_golpe',
    acao: 'escalar',
    explicacao:
      'Acusação explícita ou menção a denunciar. O robô nunca se defende de acusação de fraude — isso é conversa de humano.',
    re: palavra(
      /(voc[êe]s? s[ãa]o (uns? )?(golpista|picareta|ladr)|isso [ée] golpe|s[óo] pode ser golpe|vou (denunciar|processar|chamar)|den[úu]ncia|pol[íi]cia|delegacia|procon|minist[ée]rio p[úu]blico|\bOAB\b|boletim de ocorr[êe]ncia)/,
    ),
  },
  {
    motivo: 'obito',
    acao: 'escalar',
    explicacao:
      'Titular falecido. O crédito vira espólio e depende de inventário e herdeiros — jamais conduzido por automação.',
    re: palavra(
      /(faleceu|falecid[ao]|morreu|[óo]bito|esp[óo]lio|invent[áa]rio|de cujus|herdeir[ao]|vi[úu]v[ao]|atestado de [óo]bito)/,
    ),
  },
  {
    motivo: 'curatela_ou_interdicao',
    acao: 'escalar',
    urgente: true,
    explicacao:
      'Menção a curatela, tutela ou interdição. O robô para de vez: vira caso jurídico do Renato, porque a capacidade civil do titular está em questão.',
    re: palavra(
      /(curatela|curador[ao]?|interdit|interdi[çc][ãa]o|tutela|tutor|incapaz|n[ãa]o tem condi[çc][õo]es|alzheimer|dem[êe]ncia|acamad[ao])/,
    ),
  },

  // --- Pedido explícito -------------------------------------------------
  // Segurar a pessoa aqui é o que gera denúncia. Escala sem tentar resolver.
  {
    motivo: 'pediu_humano',
    acao: 'escalar',
    explicacao: 'A pessoa pediu pra falar com uma pessoa, ou perguntou se é robô.',
    re: palavra(
      /(falar com (algu[ée]m|uma pessoa|gente|atendente|humano|respons[áa]vel|advogad)|tem (algu[ée]m|gente) a[íi]|[ée] (um )?rob[ôo]|[ée] bot|voc[êe] [ée] rob[ôo]|isso [ée] rob[ôo]|quero falar com|me liga|pode ligar)/,
    ),
  },

  // --- Quem está do outro lado -----------------------------------------
  {
    motivo: 'nao_e_o_titular',
    acao: 'escalar',
    explicacao:
      'Quem responde não é o titular do crédito. Só o titular pode decidir sobre a cessão, e tratar terceiro como titular é passivo de LGPD.',
    re: palavra(
      /(sou (o |a )?(filh|esposa|esposo|marido|mulher|neto|neta|sobrinh|cuidador|irm[ãa]|genro|nora|m[ãa]e|pai)|falo pel[oa]|em nome d[oe] meu|[ée] d[oa] meu (pai|m[ãa]e|marido|esposa|av[ôo]|av[óo])|sou (o |a )?inventariante|respondo por ele)/,
    ),
  },
  {
    motivo: 'cessao_anterior',
    acao: 'escalar',
    explicacao:
      'Pode haver cessão anterior. Papel assinado com outra empresa pode invalidar a operação inteira — tem que ser conferido antes de qualquer conversa.',
    re: palavra(
      /(j[áa] (assinei|vendi|cedi|negociei|fechei)|assinei (um |uns )?(papel|papeis|pap[ée]is|contrato|documento)|outra empresa|outro (fundo|comprador)|j[áa] t[ée]m (uma )?proposta)/,
    ),
  },

  // --- Tom --------------------------------------------------------------
  {
    motivo: 'emocional',
    acao: 'escalar',
    explicacao:
      'Relato de doença, luto ou aperto financeiro. Acolher em uma frase e passar — nenhum robô conduz uma conversa dessas até o fim.',
    re: palavra(
      /(c[âa]ncer|tumor|quimio|doente|doen[çc]a|internad[ao]|\bUTI\b|cirurgia|transplante|cadeira de rodas|desesperad[ao]|sem dinheiro|passando fome|n[ãa]o tenho o que comer|endividad[ao]|vou perder (a casa|o im[óo]vel)|estou em luto|rem[ée]dio caro)/,
    ),
  },

  // --- Comercial e jurídico --------------------------------------------
  // "valor" é padrão largo de propósito. Se a pessoa está contando o valor do
  // processo dela, uma recusa a mais não custa nada; um número a mais custa o
  // Art. 30. A reincidência escala, então nem fica em loop.
  {
    motivo: 'preco',
    acao: 'responder_e_seguir',
    explicacao:
      'A conversa chegou em valor. O robô recusa com o texto fixo. Se insistir, escala — ele nunca dá número, faixa nem exemplo hipotético.',
    re: palavra(
      /(pre[çc]o|valor|valores|quanto|percentual|porcentagem|por cento|des[áa]gio|desconto|\bpaga(m)? quanto|me paga|vou receber|recebo quanto|quanto (sai|fica|d[áa]|vale|sobra)|proposta|or[çc]amento|\d*\s*%)/,
    ),
    resposta: RESPOSTA_RECUSA_PRECO,
  },
  {
    motivo: 'pergunta_juridica',
    acao: 'escalar',
    explicacao:
      'Pergunta jurídica real. O robô não arrisca uma resposta errada sobre direito — diz que a pergunta é importante e passa.',
    re: palavra(
      /(imposto|imposto de renda|\bIR\b|tribut|cart[óo]rio|escritura|procura[çc][ãa]o|posso vender (s[óo] )?(uma )?parte|parcial|mea[çc][ãa]o|usufruto|penhora|pens[ãa]o aliment[íi]cia|precis(o|a) de advogado|precatorio [ée] penhor)/,
    ),
  },

  // Desconfiança sem acusação fica por último de propósito: ela não para a
  // conversa, só obriga o roteiro antifraude. Qualquer regra acima que também
  // case é mais grave e vence.
  {
    motivo: 'suspeita_de_golpe',
    acao: 'responder_e_seguir',
    explicacao:
      'Desconfiança sem acusação. O robô valida a dúvida e entrega verificação independente — nunca diz "não somos golpe", que é o que golpista diz.',
    re: palavra(
      /(golpe|fraude|estelionato|conto do v[ií]garo|desconfi|n[ãa]o confio|confi[áa]vel|[ée] seguro|t[ée]m certeza que|voc[êe]s existem|mesmo real)/,
    ),
    resposta: RESPOSTA_SUSPEITA_GOLPE,
  },
];

/** Idade a partir da qual o robô só se apresenta e passa. */
export const IDADE_HIPERVULNERAVEL = 75;

/** Áudio acima disso não é pergunta, é desabafo. Vai pra humano. */
export const AUDIO_LONGO_SEGUNDOS = 60;

/**
 * Avalia uma mensagem recebida e devolve o gatilho de maior prioridade, ou
 * `null` quando o robô pode seguir conduzindo.
 *
 * Os gatilhos de contexto (idade, áudio, incompreensão, coleta completa) são
 * checados antes do texto: eles não dependem do que a pessoa escreveu agora, e
 * um deles já derruba a conversa independente do conteúdo.
 */
export function avaliarGuardrails(texto: string, ctx: ContextoConversa = {}): Gatilho | null {
  const alvo = texto ?? '';

  if (typeof ctx.idadeTitular === 'number' && ctx.idadeTitular >= IDADE_HIPERVULNERAVEL) {
    return {
      motivo: 'vulnerabilidade',
      acao: 'escalar',
      urgente: false,
      explicacao: `Titular com ${ctx.idadeTitular} anos. Acima de ${IDADE_HIPERVULNERAVEL} o robô não conduz: só se apresenta e passa. Estatuto do Idoso e CDC tratam o idoso como hipervulnerável.`,
      trecho: `idade do titular: ${ctx.idadeTitular}`,
    };
  }

  if (ctx.tipoMensagem === 'audio' && (ctx.duracaoAudioSegundos ?? 0) > AUDIO_LONGO_SEGUNDOS) {
    return {
      motivo: 'audio_longo',
      acao: 'escalar',
      urgente: false,
      explicacao: `Áudio de ${ctx.duracaoAudioSegundos}s. Acima de ${AUDIO_LONGO_SEGUNDOS}s não é pergunta, é relato — e relato longo pede humano. O broker liga em vez de escrever.`,
      trecho: `áudio de ${ctx.duracaoAudioSegundos}s`,
    };
  }

  if ((ctx.naoEntendidasSeguidas ?? 0) >= 2) {
    return {
      motivo: 'nao_entendeu',
      acao: 'escalar',
      urgente: false,
      explicacao:
        'O robô não entendeu duas mensagens seguidas. Não existe terceira tentativa — é aí que a pessoa perde a confiança.',
      trecho: `${ctx.naoEntendidasSeguidas} mensagens sem entendimento`,
    };
  }

  for (const regra of REGRAS) {
    const casou = alvo.match(regra.re);
    if (!casou) continue;

    // Preço é o único com memória: recusa uma vez, escala na insistência.
    if (regra.motivo === 'preco' && (ctx.recusasDePreco ?? 0) >= 1) {
      return {
        motivo: 'preco',
        acao: 'escalar',
        urgente: false,
        explicacao:
          'A pessoa insistiu em preço depois da recusa. Escala: o robô não repete o script nem enrola, e muito menos cede um número.',
        trecho: casou[0],
      };
    }

    return {
      motivo: regra.motivo,
      acao: regra.acao,
      urgente: regra.urgente ?? false,
      explicacao: regra.explicacao,
      trecho: casou[0],
      resposta: regra.resposta,
    };
  }

  // Caminho feliz, por último: só vale quando nada mais disparou. O robô
  // cumpriu a função e sai de cena, em vez de "continuar a relação".
  if (ctx.camposObrigatoriosCompletos) {
    return {
      motivo: 'coleta_completa',
      acao: 'escalar',
      urgente: false,
      explicacao:
        'Todos os campos obrigatórios foram confirmados. O robô cumpriu a função e passa pro broker.',
      trecho: 'coleta concluída',
    };
  }

  return null;
}

/** O robô para e a conversa vai pra fila do humano? */
export function exigeHumano(g: Gatilho | null): boolean {
  return g?.acao === 'escalar' || g?.acao === 'encerrar';
}
