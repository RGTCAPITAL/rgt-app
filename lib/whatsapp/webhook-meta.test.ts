import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assinaturaValida, lerWebhook, resumirAvisoModelo, statusAvanca } from './webhook-meta';

function pacote(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value }] }],
  };
}

describe('lerWebhook', () => {
  it('lê mensagem de texto com o nome do perfil', () => {
    const { mensagens } = lerWebhook(
      pacote({
        contacts: [{ profile: { name: 'José R.' }, wa_id: '558299510638' }],
        messages: [
          {
            from: '558299510638',
            id: 'wamid.1',
            timestamp: '1761660000',
            type: 'text',
            text: { body: 'oi' },
          },
        ],
      }),
    );
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0]).toMatchObject({
      waMessageId: 'wamid.1',
      telefone: '558299510638',
      nomePerfil: 'José R.',
      tipo: 'texto',
      conteudo: 'oi',
    });
    expect(mensagens[0].recebidaEm).toBe(new Date(1761660000 * 1000).toISOString());
  });

  it('áudio vem sem texto e com o id da mídia', () => {
    const { mensagens } = lerWebhook(
      pacote({
        messages: [
          {
            from: '55',
            id: 'w2',
            timestamp: '1',
            type: 'audio',
            audio: { id: 'MID', voice: true },
          },
        ],
      }),
    );
    expect(mensagens[0]).toMatchObject({ tipo: 'audio', conteudo: null, midiaId: 'MID' });
  });

  it('foto guarda a legenda como conteúdo', () => {
    const { mensagens } = lerWebhook(
      pacote({
        messages: [
          {
            from: '55',
            id: 'w3',
            timestamp: '1',
            type: 'image',
            image: { id: 'IMG', caption: 'meu ofício' },
          },
        ],
      }),
    );
    expect(mensagens[0]).toMatchObject({ tipo: 'imagem', conteudo: 'meu ofício', midiaId: 'IMG' });
  });

  it('botão de modelo e resposta interativa viram texto', () => {
    const { mensagens } = lerWebhook(
      pacote({
        messages: [
          {
            from: '55',
            id: 'a',
            timestamp: '1',
            type: 'button',
            button: { text: 'Quero conversar' },
          },
          {
            from: '55',
            id: 'b',
            timestamp: '2',
            type: 'interactive',
            interactive: { button_reply: { id: 'x', title: 'Sim' } },
          },
        ],
      }),
    );
    expect(mensagens.map((m) => [m.tipo, m.conteudo])).toEqual([
      ['texto', 'Quero conversar'],
      ['texto', 'Sim'],
    ]);
  });

  it('reação com emoji é ignorada', () => {
    const { mensagens } = lerWebhook(
      pacote({
        messages: [
          { from: '55', id: 'r', timestamp: '1', type: 'reaction', reaction: { emoji: '👍' } },
        ],
      }),
    );
    expect(mensagens).toHaveLength(0);
  });

  it('lê status de entrega e ignora status desconhecido', () => {
    const { status } = lerWebhook(
      pacote({
        statuses: [
          { id: 'w1', status: 'delivered' },
          { id: 'w2', status: 'read' },
          { id: 'w3', status: 'deleted' },
        ],
      }),
    );
    expect(status).toEqual([
      { waMessageId: 'w1', status: 'entregue' },
      { waMessageId: 'w2', status: 'lida' },
    ]);
  });

  it('pacote estranho não derruba: devolve vazio', () => {
    expect(lerWebhook(null)).toEqual({ mensagens: [], status: [], modelos: [] });
    expect(lerWebhook({ entry: 'x' })).toEqual({ mensagens: [], status: [], modelos: [] });
    expect(lerWebhook(pacote({ messages: [{ type: 'text' }] })).mensagens).toHaveLength(0);
  });

  it('ordena por horário quando a Meta agrupa', () => {
    const { mensagens } = lerWebhook(
      pacote({
        messages: [
          { from: '55', id: 'segunda', timestamp: '20', type: 'text', text: { body: 'b' } },
          { from: '55', id: 'primeira', timestamp: '10', type: 'text', text: { body: 'a' } },
        ],
      }),
    );
    expect(mensagens.map((m) => m.waMessageId)).toEqual(['primeira', 'segunda']);
  });
});

describe('assinaturaValida', () => {
  const segredo = 'segredo-do-app';
  const corpo = '{"entry":[{"x":"ação"}]}';
  const assinatura = `sha256=${createHmac('sha256', segredo).update(corpo, 'utf8').digest('hex')}`;

  it('aceita a assinatura certa', () => {
    expect(assinaturaValida(corpo, assinatura, segredo)).toBe(true);
  });

  it('recusa corpo alterado, segredo errado, cabeçalho ausente ou malformado', () => {
    expect(assinaturaValida(corpo + ' ', assinatura, segredo)).toBe(false);
    expect(assinaturaValida(corpo, assinatura, 'outro')).toBe(false);
    expect(assinaturaValida(corpo, null, segredo)).toBe(false);
    expect(assinaturaValida(corpo, 'sha1=abc', segredo)).toBe(false);
    expect(assinaturaValida(corpo, 'sha256=zz', segredo)).toBe(false);
  });

  it('sem segredo configurado, recusa tudo', () => {
    expect(assinaturaValida(corpo, assinatura, '')).toBe(false);
  });
});

describe('statusAvanca', () => {
  it('só anda pra frente', () => {
    expect(statusAvanca('enviando', 'enviada')).toBe(true);
    expect(statusAvanca('enviada', 'lida')).toBe(true);
    expect(statusAvanca('lida', 'entregue')).toBe(false);
    expect(statusAvanca('entregue', 'entregue')).toBe(false);
    expect(statusAvanca(null, 'enviada')).toBe(true);
  });

  it('falha vale mesmo depois de enviada, mas não volta de falha', () => {
    expect(statusAvanca('enviada', 'falhou')).toBe(true);
    expect(statusAvanca('falhou', 'lida')).toBe(false);
    expect(statusAvanca('falhou', 'falhou')).toBe(false);
  });
});

describe('avisos de modelo', () => {
  const pacoteModelo = (field: string, value: Record<string, unknown>) => ({
    entry: [{ id: 'WABA', changes: [{ field, value }] }],
  });

  it('lê aprovação e recusa de modelo', () => {
    const aprovado = lerWebhook(
      pacoteModelo('message_template_status_update', {
        event: 'APPROVED',
        message_template_name: 'rgt_proposta_credor',
        message_template_language: 'pt_BR',
        reason: 'NONE',
      }),
    );
    expect(aprovado.modelos).toEqual([
      {
        modelo: 'rgt_proposta_credor',
        tipo: 'status',
        valor: 'APPROVED',
        anterior: null,
        motivo: null,
      },
    ]);
    expect(aprovado.mensagens).toHaveLength(0);

    const recusado = lerWebhook(
      pacoteModelo('message_template_status_update', {
        event: 'REJECTED',
        message_template_name: 'rgt_proposta_advogado',
        reason: 'INCORRECT_CATEGORY',
      }),
    );
    expect(recusado.modelos[0]).toMatchObject({ valor: 'REJECTED', motivo: 'INCORRECT_CATEGORY' });
  });

  it('lê mudança de qualidade', () => {
    const { modelos } = lerWebhook(
      pacoteModelo('message_template_quality_update', {
        previous_quality_score: 'GREEN',
        new_quality_score: 'RED',
        message_template_name: 'rgt_proposta_credor',
      }),
    );
    expect(modelos).toEqual([
      {
        modelo: 'rgt_proposta_credor',
        tipo: 'qualidade',
        valor: 'RED',
        anterior: 'GREEN',
        motivo: null,
      },
    ]);
  });

  it('pausa, recusa e vermelho são urgentes; aprovação não', () => {
    const base = { modelo: 'm', anterior: null, motivo: null };
    expect(resumirAvisoModelo({ ...base, tipo: 'status', valor: 'PAUSED' })?.urgente).toBe(true);
    expect(resumirAvisoModelo({ ...base, tipo: 'status', valor: 'REJECTED' })?.urgente).toBe(true);
    expect(resumirAvisoModelo({ ...base, tipo: 'qualidade', valor: 'RED' })?.urgente).toBe(true);
    expect(resumirAvisoModelo({ ...base, tipo: 'status', valor: 'APPROVED' })?.urgente).toBe(false);
    expect(resumirAvisoModelo({ ...base, tipo: 'qualidade', valor: 'YELLOW' })?.urgente).toBe(
      false,
    );
  });

  it('não avisa o que não muda nada', () => {
    const base = { modelo: 'm', motivo: null };
    expect(
      resumirAvisoModelo({ ...base, tipo: 'status', valor: 'PENDING', anterior: null }),
    ).toBeNull();
    expect(
      resumirAvisoModelo({ ...base, tipo: 'qualidade', valor: 'GREEN', anterior: 'GREEN' }),
    ).toBeNull();
    expect(
      resumirAvisoModelo({ ...base, tipo: 'qualidade', valor: 'GREEN', anterior: 'YELLOW' }),
    ).not.toBeNull();
  });
});
