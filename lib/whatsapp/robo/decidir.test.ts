import { describe, expect, it, vi } from 'vitest';
import { RESPOSTA_RECUSA_PRECO } from '../guardrails';
import { decidirProximoPasso, type ChamarIA, type EntradaRobo } from './decidir';
import type { DadosColetados, DecisaoRobo } from './schema';

const DADOS_VAZIOS: DadosColetados = {
  titularidade_confirmada: null,
  interesse_em_vender: null,
  estado_civil: null,
  cessao_anterior: null,
  tem_advogado_no_processo: null,
  acompanhante_familiar: null,
  motivo_da_venda: null,
};

function entrada(texto: string, ctx: EntradaRobo['ctx'] = {}): EntradaRobo {
  return {
    historico: [{ autor: 'contato', conteudo: texto }],
    ctx,
    processo: {
      credor: 'José',
      tribunal: 'TJAL',
      ente_devedor: 'Estado de Alagoas',
      numero_processo: null,
    },
  };
}

/** IA falsa que devolve sempre a mesma decisão — e conta se foi chamada. */
function iaQueResponde(parcial: Partial<DecisaoRobo>) {
  return vi.fn<ChamarIA>(async () => ({
    resposta: 'Oi! Sou o assistente automático da RGT Capital.',
    entendeu: true,
    passar_para_humano: false,
    motivo_passagem: null,
    dados: DADOS_VAZIOS,
    ...parcial,
  }));
}

describe('robô · freio de entrada vem antes da IA', () => {
  it('pergunta de preço não chega na IA', async () => {
    const ia = iaQueResponde({});
    const plano = await decidirProximoPasso(entrada('quanto vocês pagam?'), ia);
    expect(ia).not.toHaveBeenCalled();
    expect(plano).toMatchObject({
      fonte: 'freio_entrada',
      enviar: RESPOSTA_RECUSA_PRECO,
      recusouPreco: true,
      pausar: null,
    });
  });

  it('insistência em preço escala, ainda sem IA', async () => {
    const ia = iaQueResponde({});
    const plano = await decidirProximoPasso(entrada('mas quanto?', { recusasDePreco: 1 }), ia);
    expect(ia).not.toHaveBeenCalled();
    expect(plano.pausar).not.toBeNull();
    expect(plano.recusouPreco).toBe(false);
  });

  it('opt-out encerra, confirma e grava a saída', async () => {
    const plano = await decidirProximoPasso(entrada('SAIR'), iaQueResponde({}));
    expect(plano).toMatchObject({ optout: true, gatilho: 'optout' });
    expect(plano.enviar).toMatch(/não vamos mais mandar/i);
  });

  it('óbito passa com texto de acolhimento, não com o padrão', async () => {
    const plano = await decidirProximoPasso(entrada('meu pai faleceu'), iaQueResponde({}));
    expect(plano.enviar).toMatch(/^Sinto muito/);
    expect(plano.pausar).not.toBeNull();
  });

  it('taxa já paga passa como urgente', async () => {
    const plano = await decidirProximoPasso(
      entrada('já paguei uma taxa de 3 mil'),
      iaQueResponde({}),
    );
    expect(plano.pausar?.urgente).toBe(true);
  });

  it('titular com 75+ não conversa com a IA', async () => {
    const ia = iaQueResponde({});
    const plano = await decidirProximoPasso(entrada('bom dia', { idadeTitular: 80 }), ia);
    expect(ia).not.toHaveBeenCalled();
    expect(plano.gatilho).toBe('vulnerabilidade');
  });
});

describe('robô · áudio, foto e documento', () => {
  it.each([
    ['audio', /um áudio/],
    ['imagem', /uma foto/],
    ['documento', /um documento/],
  ] as const)('%s passa pro broker sem chamar a IA', async (tipoMensagem, motivo) => {
    const ia = iaQueResponde({});
    const plano = await decidirProximoPasso(entrada('', { tipoMensagem }), ia);
    expect(ia).not.toHaveBeenCalled();
    expect(plano.gatilho).toBe('midia');
    expect(plano.pausar?.motivo).toMatch(motivo);
    // Nunca "não consigo ouvir áudio": a pesquisa proíbe.
    expect(plano.enviar).not.toMatch(/áudio|ouvir/i);
  });

  it('legenda com SAIR ainda é opt-out', async () => {
    const plano = await decidirProximoPasso(
      entrada('SAIR', { tipoMensagem: 'imagem' }),
      iaQueResponde({}),
    );
    expect(plano.optout).toBe(true);
  });

  it('foto com legenda perguntando preço passa, não responde só o texto', async () => {
    const plano = await decidirProximoPasso(
      entrada('quanto vocês pagam nesse?', { tipoMensagem: 'imagem' }),
      iaQueResponde({}),
    );
    expect(plano.gatilho).toBe('midia');
    expect(plano.pausar).not.toBeNull();
  });
});

describe('robô · freio de saída barra a IA', () => {
  it.each([
    'Normalmente a gente paga uns 70% do valor.',
    'Me manda seu CPF que eu já adianto.',
    'Pode confiar, não somos golpe.',
    'Dá pra fechar até sexta.',
  ])('o texto da IA não sai: %s', async (resposta) => {
    const plano = await decidirProximoPasso(entrada('bom dia'), iaQueResponde({ resposta }));
    expect(plano.fonte).toBe('freio_saida');
    expect(plano.enviar).not.toContain(resposta);
    expect(plano.pausar?.motivo).toMatch(/barrada/);
  });
});

describe('robô · caminho normal', () => {
  it('manda a resposta da IA e devolve os dados', async () => {
    const dados = { ...DADOS_VAZIOS, titularidade_confirmada: true };
    const plano = await decidirProximoPasso(
      entrada('sim, é meu'),
      iaQueResponde({ resposta: 'Que bom! Tem interesse em vender agora?', dados }),
    );
    expect(plano).toMatchObject({ fonte: 'ia', pausar: null, dados });
    expect(plano.enviar).toBe('Que bom! Tem interesse em vender agora?');
  });

  it('IA pediu passagem: manda a resposta e pausa com o motivo dela', async () => {
    const plano = await decidirProximoPasso(
      entrada('quero tratar com o dono da empresa sobre outra coisa'),
      iaQueResponde({ passar_para_humano: true, motivo_passagem: 'Assunto fora do roteiro.' }),
    );
    expect(plano.pausar?.motivo).toBe('Assunto fora do roteiro.');
  });

  it('coleta completa pausa mesmo se a IA esqueceu de passar', async () => {
    const completos: DadosColetados = {
      ...DADOS_VAZIOS,
      titularidade_confirmada: true,
      interesse_em_vender: 'sim',
      estado_civil: 'casado',
      cessao_anterior: false,
      tem_advogado_no_processo: true,
    };
    const plano = await decidirProximoPasso(
      entrada('sim, ainda falo com ele'),
      iaQueResponde({ dados: completos, passar_para_humano: false }),
    );
    expect(plano.gatilho).toBe('coleta_completa');
    expect(plano.pausar).not.toBeNull();
  });

  it('IA não entendeu: marca pra somar no contador', async () => {
    const plano = await decidirProximoPasso(
      entrada('aham kkk'),
      iaQueResponde({
        entendeu: false,
        resposta: 'Desculpa, não entendi. Pode explicar de outro jeito?',
      }),
    );
    expect(plano.naoEntendeu).toBe(true);
  });

  it('IA falhou: a pessoa recebe a passagem, não silêncio', async () => {
    const ia = vi.fn<ChamarIA>(async () => {
      throw new Error('timeout');
    });
    const plano = await decidirProximoPasso(entrada('bom dia'), ia);
    expect(plano.fonte).toBe('erro_ia');
    expect(plano.enviar).toMatch(/pessoa da nossa equipe/);
    expect(plano.pausar?.motivo).toMatch(/timeout/);
  });
});
