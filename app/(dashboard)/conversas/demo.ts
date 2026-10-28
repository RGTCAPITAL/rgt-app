import type { ConversaLinha, MensagemLinha } from './tipos';

/**
 * Conversas de exemplo pra ver a tela antes do número da RGT existir.
 *
 * Ficam no código, não no banco, de propósito: `whatsapp_mensagens` não aceita
 * DELETE (é a prova do que foi dito), então qualquer conversa falsa gravada em
 * produção ficaria lá pra sempre. Só abre fora de produção, com `?demo=1`.
 *
 * Cada conversa mostra um caminho real do roteiro: o robô recusando preço e
 * escalando, o robô conduzindo, o advogado que cai direto com o broker, e o
 * contato frio sem resposta.
 */

const MIN = 60_000;
const HORA = 60 * MIN;

export function demoDisponivel(param: string | undefined): boolean {
  return param === '1' && process.env.NODE_ENV !== 'production';
}

export function conversasDemo(agora = Date.now()): {
  conversas: ConversaLinha[];
  mensagens: Record<string, MensagemLinha[]>;
} {
  const em = (ms: number) => new Date(agora - ms).toISOString();
  const ate = (ms: number) => new Date(agora + ms).toISOString();
  const dono = { nome: 'Broker de exemplo' };

  let n = 0;
  const msg = (
    autor: MensagemLinha['autor'],
    conteudo: string,
    haQuanto: number,
    extra: Partial<MensagemLinha> = {},
  ): MensagemLinha => ({
    id: `demo-m${++n}`,
    direcao: autor === 'contato' ? 'entrada' : 'saida',
    autor,
    conteudo,
    tipo: 'texto',
    template_nome: null,
    status_entrega: autor === 'contato' ? null : 'lida',
    created_at: em(haQuanto),
    autor_usuario: autor === 'humano' ? dono : null,
    ...extra,
  });

  const mensagens: Record<string, MensagemLinha[]> = {
    'demo-jose': [
      msg('contato', 'Boa tarde. Vi o site de vocês, tenho um processo contra o estado', 70 * MIN),
      msg(
        'bot',
        'Boa tarde! Eu sou o assistente automático da RGT Capital — sou um robô, e vou te passar pra uma pessoa da equipe sempre que precisar.\n\nVocê não me conhece, então é normal desconfiar. Pode conferir o CNPJ da RGT no site da Receita, e perguntar ao advogado do seu processo.',
        69 * MIN,
      ),
      msg('contato', 'entendi. e quanto vocês pagam?', 50 * MIN),
      msg(
        'bot',
        'Essa é a pergunta certa, e eu não vou fingir que sei.\n\nEu sou o robô da triagem — eu não calculo valor e não tenho autorização pra dizer número nenhum. Quem faz o cálculo é um analista aqui, olhando o seu processo, o valor atualizado e o ano previsto pra pagamento.',
        49 * MIN,
      ),
      msg('contato', 'mas mais ou menos quanto? só pra eu ter uma ideia', 30 * MIN),
    ],
    'demo-maria': [
      msg('contato', 'Oi, preenchi o formulário agora', 25 * MIN),
      msg(
        'bot',
        'Oi, Maria! Recebi sim. Sou o assistente automático da RGT Capital.\n\nVi aqui que o seu processo é contra o Estado de Alagoas, no TJAL. Bate com o seu?',
        24 * MIN,
      ),
      msg('contato', 'isso, é da época que eu era professora', 20 * MIN),
      msg(
        'bot',
        'Perfeito. Não tem resposta errada pra próxima pergunta: você tem interesse em vender esse crédito agora, ou prefere continuar esperando o pagamento?',
        19 * MIN,
      ),
    ],
    'demo-advogado': [
      msg(
        'humano',
        'Dr. Carlos, boa tarde. Sou o Broker de exemplo, da RGT Capital. Vi que você representa um credor com ofício requisitório expedido no TRT19. Temos interesse em apresentar uma proposta de cessão. Podemos conversar?',
        3 * HORA,
        { template_nome: 'abordagem_advogado' },
      ),
      msg('contato', 'Boa tarde. Pode sim. Qual o percentual que vocês trabalham?', 40 * MIN),
    ],
    'demo-antonio': [
      msg(
        'humano',
        'Sr. Antônio, boa tarde. Sou o Broker de exemplo, da RGT Capital. Podemos conversar sobre o seu precatório?',
        3 * 24 * HORA,
        { template_nome: 'abordagem_credor', status_entrega: 'entregue' },
      ),
    ],
  };

  const ultima = (id: string) => {
    const m = mensagens[id].at(-1)!;
    return { autor: m.autor, conteudo: m.conteudo, tipo: m.tipo };
  };

  const conversas: ConversaLinha[] = [
    {
      id: 'demo-jose',
      status: 'aguardando_humano',
      bot_pausado: true,
      pausado_motivo:
        'A pessoa insistiu em preço depois da recusa. Escala: o robô não repete o script nem enrola, e muito menos cede um número.',
      ultima_em: em(30 * MIN),
      dados_coletados: {
        titularidade_confirmada: true,
        interesse_em_vender: 'talvez',
        estado_civil: 'casado',
        cessao_anterior: null,
        tem_advogado_no_processo: null,
        acompanhante_familiar: null,
        motivo_da_venda: null,
        devedor_informado: null,
        tribunal_informado: null,
        numero_processo_informado: null,
      },
      telefone: '5582999990001',
      nome_perfil: 'José R.',
      janela_expira_em: ate(23.5 * HORA),
      lead: { id: 'demo-l1', nome: 'José Ribamar da Silva', dono_id: null, dono: null },
      ultima: ultima('demo-jose'),
    },
    {
      id: 'demo-maria',
      status: 'aberta',
      bot_pausado: false,
      pausado_motivo: null,
      ultima_em: em(19 * MIN),
      dados_coletados: null,
      telefone: '5582999990002',
      nome_perfil: 'Maria',
      janela_expira_em: ate(23.6 * HORA),
      lead: { id: 'demo-l2', nome: 'Maria das Graças Lima', dono_id: 'demo-broker', dono },
      ultima: ultima('demo-maria'),
    },
    {
      id: 'demo-advogado',
      status: 'aguardando_humano',
      bot_pausado: true,
      pausado_motivo: 'Contato com advogado: conversa direto com o broker, sem robô.',
      ultima_em: em(40 * MIN),
      dados_coletados: null,
      telefone: '5582999990003',
      nome_perfil: 'Carlos Adv',
      janela_expira_em: ate(80 * MIN),
      lead: { id: 'demo-l3', nome: 'Dr. Carlos Menezes (advogado)', dono_id: 'demo-broker', dono },
      ultima: ultima('demo-advogado'),
    },
    {
      id: 'demo-antonio',
      status: 'aberta',
      bot_pausado: true,
      pausado_motivo: null,
      ultima_em: em(3 * 24 * HORA),
      dados_coletados: null,
      telefone: '5582999990004',
      nome_perfil: null,
      janela_expira_em: null,
      lead: { id: 'demo-l4', nome: 'Antônio Ferreira', dono_id: 'demo-broker', dono },
      ultima: ultima('demo-antonio'),
    },
  ];

  return { conversas, mensagens };
}
