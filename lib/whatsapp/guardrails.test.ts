import { describe, expect, it } from 'vitest';
import {
  avaliarGuardrails,
  exigeHumano,
  RESPOSTA_RECUSA_PRECO,
  type MotivoGatilho,
} from './guardrails';

/**
 * Estes testes são a trava de verdade. O módulo existe pra garantir que o robô
 * nunca fale preço e nunca conduza conversa que não é dele — se o teste passar
 * e o comportamento estiver errado, a proteção jurídica não existe.
 */

function motivo(texto: string, ctx = {}): MotivoGatilho | null {
  return avaliarGuardrails(texto, ctx)?.motivo ?? null;
}

describe('guardrails · preço', () => {
  const perguntas = [
    'quanto vocês pagam?',
    'qual o valor que eu recebo',
    'me diz o percentual',
    'é quantos % do precatório',
    'quanto sai pra mim',
    'qual o deságio',
    'faz uma proposta pra mim',
    'quanto vale isso',
  ];

  it.each(perguntas)('recusa na primeira vez: %s', (texto) => {
    const g = avaliarGuardrails(texto, { recusasDePreco: 0 });
    expect(g?.motivo).toBe('preco');
    expect(g?.acao).toBe('responder_e_seguir');
    expect(g?.resposta).toBe(RESPOSTA_RECUSA_PRECO);
  });

  it.each(perguntas)('escala na insistência: %s', (texto) => {
    const g = avaliarGuardrails(texto, { recusasDePreco: 1 });
    expect(g?.motivo).toBe('preco');
    expect(g?.acao).toBe('escalar');
    expect(exigeHumano(g)).toBe(true);
  });

  it('a resposta de recusa não contém número nenhum', () => {
    // O texto é constante, mas é o ponto exato onde um ajuste descuidado de
    // copy viraria oferta vinculante (Art. 30 CDC). Trava aqui.
    expect(RESPOSTA_RECUSA_PRECO).not.toMatch(/\d/);
    expect(RESPOSTA_RECUSA_PRECO).not.toMatch(/%/);
    expect(RESPOSTA_RECUSA_PRECO).toMatch(/não tenho autorização/);
    // Admitir que o valor à vista é menor é obrigatório: é o que separa a RGT
    // de quem promete o valor cheio.
    expect(RESPOSTA_RECUSA_PRECO).toMatch(/menor que o valor cheio/);
  });

  it('o módulo nunca devolve uma resposta com número', () => {
    const comResposta = [...perguntas, 'isso é golpe né', 'tô desconfiado']
      .map((t) => avaliarGuardrails(t))
      .filter((g) => g?.resposta);

    expect(comResposta.length).toBeGreaterThan(0);
    for (const g of comResposta) {
      expect(g!.resposta).not.toMatch(/\d+\s*%|\bR\$/);
    }
  });
});

describe('guardrails · dever legal e risco à pessoa', () => {
  it('reconhece o pedido de saída', () => {
    expect(motivo('SAIR')).toBe('optout');
    expect(motivo('para')).toBe('optout');
    expect(motivo('não quero mais receber essas mensagens')).toBe('optout');
    expect(motivo('me tira da lista por favor')).toBe('optout');
    expect(avaliarGuardrails('SAIR')?.acao).toBe('encerrar');
  });

  it('não confunde "não quero vender" com pedido de saída', () => {
    // Opt-out não tem volta. Tratar resposta de desinteresse como descadastro
    // apagaria um lead legítimo pra sempre.
    expect(motivo('não quero vender agora, prefiro esperar')).not.toBe('optout');
    expect(motivo('acho que não quero')).not.toBe('optout');
  });

  it('trata taxa já paga como urgente', () => {
    const g = avaliarGuardrails('paguei 3 mil de taxa pra um cara liberar');
    expect(g?.motivo).toBe('possivel_golpe_em_andamento');
    expect(g?.urgente).toBe(true);
  });

  it('taxa paga vence a pergunta de preço na mesma mensagem', () => {
    // A ordem das regras é a decisão de produto mais importante do módulo.
    expect(motivo('paguei uma taxa de 3 mil, e vocês pagam quanto?')).toBe(
      'possivel_golpe_em_andamento',
    );
  });

  it('escala acusação explícita, sem deixar o robô se defender', () => {
    expect(motivo('vocês são golpistas')).toBe('acusacao_de_golpe');
    expect(motivo('vou denunciar no Procon')).toBe('acusacao_de_golpe');
    expect(motivo('isso é golpe')).toBe('acusacao_de_golpe');
  });

  it('desconfiança sem acusação segue com roteiro fixo', () => {
    const g = avaliarGuardrails('tô desconfiado, isso é confiável?');
    expect(g?.motivo).toBe('suspeita_de_golpe');
    expect(g?.acao).toBe('responder_e_seguir');
    // Nunca negar: quem diz "não somos golpe" é golpista.
    expect(g?.resposta).not.toMatch(/não somos golpe/i);
    expect(g?.resposta).toMatch(/certo em desconfiar/);
    expect(g?.resposta).toMatch(/ninguém precisa pagar nada/);
  });

  it('óbito nunca é conduzido por automação', () => {
    expect(motivo('meu pai faleceu ano passado')).toBe('obito');
    expect(motivo('está em inventário')).toBe('obito');
    expect(exigeHumano(avaliarGuardrails('ele morreu'))).toBe(true);
  });

  it('curatela e interdição param de vez e são urgentes', () => {
    const g = avaliarGuardrails('ele está interditado, eu sou o curador');
    expect(g?.motivo).toBe('curatela_ou_interdicao');
    expect(g?.urgente).toBe(true);
  });
});

describe('guardrails · quem está do outro lado', () => {
  it('detecta que não é o titular', () => {
    expect(motivo('sou a filha dele')).toBe('nao_e_o_titular');
    expect(motivo('falo pelo meu marido')).toBe('nao_e_o_titular');
  });

  it('detecta cessão anterior', () => {
    expect(motivo('já assinei um papel com outra empresa')).toBe('cessao_anterior');
    expect(motivo('já vendi uma parte')).toBe('cessao_anterior');
  });

  it('escala quando pedem humano', () => {
    expect(motivo('isso é robô?')).toBe('pediu_humano');
    expect(motivo('quero falar com alguém')).toBe('pediu_humano');
    expect(motivo('tem gente aí')).toBe('pediu_humano');
    expect(motivo('pode ligar pra mim')).toBe('pediu_humano');
  });

  it('acolhe e passa quando o relato é emocional', () => {
    expect(motivo('minha esposa está com câncer')).toBe('emocional');
    expect(motivo('estou desesperado, vou perder a casa')).toBe('emocional');
  });

  it('escala pergunta jurídica em vez de arriscar resposta errada', () => {
    expect(motivo('e o imposto de renda sobre isso?')).toBe('pergunta_juridica');
    expect(motivo('preciso ir no cartório?')).toBe('pergunta_juridica');
    expect(motivo('posso vender só uma parte?')).toBe('pergunta_juridica');
  });
});

describe('guardrails · contexto, antes do texto', () => {
  it('idade igual ou acima de 75 escala independente do que a pessoa escreveu', () => {
    const g = avaliarGuardrails('bom dia, tudo bem?', { idadeTitular: 78 });
    expect(g?.motivo).toBe('vulnerabilidade');
    expect(g?.explicacao).toMatch(/78 anos/);
  });

  it('74 anos não dispara sozinho', () => {
    expect(avaliarGuardrails('bom dia, tudo bem?', { idadeTitular: 74 })).toBeNull();
  });

  it('idade ausente ou nula não dispara', () => {
    expect(avaliarGuardrails('bom dia', { idadeTitular: null })).toBeNull();
    expect(avaliarGuardrails('bom dia', {})).toBeNull();
  });

  it('áudio longo vai pra humano; áudio curto não', () => {
    expect(motivo('', { tipoMensagem: 'audio', duracaoAudioSegundos: 95 })).toBe('audio_longo');
    expect(avaliarGuardrails('', { tipoMensagem: 'audio', duracaoAudioSegundos: 12 })).toBeNull();
  });

  it('não entender duas vezes escala, uma vez não', () => {
    expect(motivo('aham', { naoEntendidasSeguidas: 2 })).toBe('nao_entendeu');
    expect(avaliarGuardrails('aham', { naoEntendidasSeguidas: 1 })).toBeNull();
  });

  it('coleta completa só vale quando nada mais disparou', () => {
    expect(motivo('então é isso, obrigado', { camposObrigatoriosCompletos: true })).toBe(
      'coleta_completa',
    );
    // Se a pessoa perguntou preço na última mensagem, o preço vence.
    expect(motivo('e quanto eu recebo?', { camposObrigatoriosCompletos: true })).toBe('preco');
  });
});

describe('guardrails · conversa normal não dispara', () => {
  const inofensivas = [
    'bom dia',
    'sim, sou eu mesmo',
    'é isso, processo contra o estado',
    'ganhei em 2019, era da escola',
    'sou casado sim',
    'ainda tenho contato com o advogado',
    'vou falar com meu filho e te respondo',
    'obrigado pela atenção',
  ];

  it.each(inofensivas)('segue conduzindo: %s', (texto) => {
    expect(avaliarGuardrails(texto)).toBeNull();
  });
});

describe('guardrails · acento e radical (regressão)', () => {
  // A primeira versão usava `\b`, que no JavaScript é ASCII e não vê fronteira
  // ao lado de letra acentuada. Cada caso abaixo falhava calado.
  it.each([
    ['tem atestado de óbito', 'obito'],
    ['é robô?', 'pediu_humano'],
    ['quero falar com a advogada', 'pediu_humano'],
    ['ele está interditado', 'curatela_ou_interdicao'],
    ['quero me descadastrar', 'optout'],
    ['me cobraram honorários adiantados', 'possivel_golpe_em_andamento'],
    ['quais os preços', 'preco'],
    ['vocês pagam 30%?', 'preco'],
    ['tô desconfiada', 'suspeita_de_golpe'],
    ['e a tributação?', 'pergunta_juridica'],
    ['ÓBITO', 'obito'],
  ])('%s → %s', (texto, esperado) => {
    expect(motivo(texto)).toBe(esperado);
  });

  it('não casa no meio de palavra', () => {
    // "paralelo" começa com "para", que sozinho é opt-out. Não pode disparar.
    expect(motivo('é um processo paralelo')).toBeNull();
    // "desvalorizado" contém "valor", que é gatilho de preço.
    expect(motivo('o terreno ficou desvalorizado')).toBeNull();
  });
});

describe('guardrails · bordas', () => {
  it('mensagem vazia não dispara nem quebra', () => {
    expect(avaliarGuardrails('')).toBeNull();
    expect(avaliarGuardrails('   ')).toBeNull();
  });

  it('exigeHumano é falso quando nada disparou ou quando o robô só responde', () => {
    expect(exigeHumano(null)).toBe(false);
    expect(exigeHumano(avaliarGuardrails('quanto vocês pagam?'))).toBe(false);
  });

  it('todo gatilho carrega explicação e trecho, pro broker conferir', () => {
    const amostra = [
      'quanto vocês pagam?',
      'SAIR',
      'ele faleceu',
      'sou a filha dele',
      'vou denunciar',
      'minha esposa está com câncer',
    ];
    for (const texto of amostra) {
      const g = avaliarGuardrails(texto);
      expect(g, texto).not.toBeNull();
      expect(g!.explicacao.length, texto).toBeGreaterThan(20);
      expect(g!.trecho.length, texto).toBeGreaterThan(0);
    }
  });
});
