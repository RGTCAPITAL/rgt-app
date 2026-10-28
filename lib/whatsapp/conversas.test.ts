import { describe, expect, it } from 'vitest';
import { esperaBroker, estadoJanela, ordenarConversas, type ConversaResumo } from './conversas';

const AGORA = new Date('2026-10-28T15:00:00Z');
const daqui = (ms: number) => new Date(AGORA.getTime() + ms).toISOString();

describe('estadoJanela', () => {
  it('sem data é fechada: contato frio não tem janela', () => {
    expect(estadoJanela(null, AGORA).aberta).toBe(false);
    expect(estadoJanela(undefined, AGORA).rotulo).toBe('ainda não aberta');
  });

  it('no passado é fechada', () => {
    expect(estadoJanela(daqui(-1), AGORA)).toMatchObject({ aberta: false, rotulo: 'fechada' });
  });

  it('mostra horas cheias acima de 1h', () => {
    expect(estadoJanela(daqui(5.5 * 3600_000), AGORA)).toMatchObject({
      aberta: true,
      rotulo: 'fecha em 5h',
      fechandoLogo: false,
    });
  });

  it('mostra minutos abaixo de 1h e avisa que está fechando', () => {
    expect(estadoJanela(daqui(12 * 60_000), AGORA)).toMatchObject({
      aberta: true,
      rotulo: 'fecha em 12 min',
      fechandoLogo: true,
    });
  });

  it('nunca mostra "0 min" com a janela ainda aberta', () => {
    expect(estadoJanela(daqui(20_000), AGORA).rotulo).toBe('fecha em 1 min');
  });

  it('data inválida é fechada, não aberta', () => {
    expect(estadoJanela('lixo', AGORA).aberta).toBe(false);
  });
});

describe('ordenarConversas', () => {
  const c = (id: string, extra: Partial<ConversaResumo>): ConversaResumo => ({
    id,
    status: 'aberta',
    bot_pausado: false,
    ultima_em: '2026-10-28T10:00:00Z',
    ultima: { autor: 'contato' },
    ...extra,
  });

  it('quem espera o broker vem antes, mesmo sendo mais antiga', () => {
    const ordem = ordenarConversas([
      c('robo-recente', { ultima_em: '2026-10-28T14:00:00Z' }),
      c('esperando', { status: 'aguardando_humano', ultima_em: '2026-10-28T09:00:00Z' }),
    ]).map((x) => x.id);
    expect(ordem).toEqual(['esperando', 'robo-recente']);
  });

  it('robô pausado com a pessoa falando por último espera o broker', () => {
    const ordem = ordenarConversas([c('robo', {}), c('pausado', { bot_pausado: true })]).map(
      (x) => x.id,
    );
    expect(ordem).toEqual(['pausado', 'robo']);
  });

  it('contato frio sem resposta não espera o broker: quem deve resposta é a pessoa', () => {
    const frio = c('frio', {
      bot_pausado: true,
      ultima_em: '2026-10-28T14:00:00Z',
      ultima: { autor: 'humano' },
    });
    expect(esperaBroker(frio)).toBe(false);
    const ordem = ordenarConversas([frio, c('esperando', { bot_pausado: true })]).map((x) => x.id);
    expect(ordem).toEqual(['esperando', 'frio']);
  });

  it('robô conduzindo não espera o broker, mesmo com a pessoa falando por último', () => {
    expect(esperaBroker(c('robo', {}))).toBe(false);
  });

  it('encerrada nunca espera o broker', () => {
    expect(esperaBroker(c('fim', { status: 'encerrada', bot_pausado: true }))).toBe(false);
  });

  it('encerrada vai pro fim', () => {
    const ordem = ordenarConversas([
      c('fim', { status: 'encerrada', ultima_em: '2026-10-28T14:59:00Z' }),
      c('robo', {}),
    ]).map((x) => x.id);
    expect(ordem).toEqual(['robo', 'fim']);
  });

  it('dentro do grupo, a mais recente em cima', () => {
    const ordem = ordenarConversas([
      c('velha', { ultima_em: '2026-10-27T10:00:00Z' }),
      c('nova', { ultima_em: '2026-10-28T10:00:00Z' }),
    ]).map((x) => x.id);
    expect(ordem).toEqual(['nova', 'velha']);
  });

  it('não altera a lista original', () => {
    const lista = [c('b', { ultima_em: '1' }), c('a', { ultima_em: '2' })];
    ordenarConversas(lista);
    expect(lista.map((x) => x.id)).toEqual(['b', 'a']);
  });
});
