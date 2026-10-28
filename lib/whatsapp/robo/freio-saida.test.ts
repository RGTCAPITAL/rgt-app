import { describe, expect, it } from 'vitest';
import { RESPOSTA_RECUSA_PRECO, RESPOSTA_SUSPEITA_GOLPE } from '../guardrails';
import { verificarSaida } from './freio-saida';

const bloqueia = (t: string) => verificarSaida(t).ok === false;

describe('freio de saída · bloqueia', () => {
  it.each([
    'Normalmente fica em torno de 70% do valor.',
    'Tem gente que recebe R$ 50.000 à vista.',
    'Pagamos uns 60 por cento.',
    'Seu crédito vale uns 120 mil.',
    'O valor de 150.000,00 pode ser antecipado.',
    'O deságio costuma ser baixo.',
    'Oferecemos as melhores condições.',
  ])('dinheiro: %s', (t) => expect(bloqueia(t)).toBe(true));

  it.each([
    'O dinheiro cai em 15 dias.',
    'A gente fecha até sexta.',
    'Dá pra resolver essa semana.',
  ])('prazo: %s', (t) => expect(bloqueia(t)).toBe(true));

  it.each([
    'Me manda uma foto do seu documento.',
    'Qual o seu CPF?',
    'Pode me passar a chave PIX?',
    'Preciso dos seus dados bancários.',
  ])('pedido de documento: %s', (t) => expect(bloqueia(t)).toBe(true));

  it.each([
    'Pode ficar tranquilo, não somos golpe.',
    'Essa proposta é válida até sexta.',
    'É sua última chance.',
    'Não sou robô, sou da equipe.',
  ])('postura proibida: %s', (t) => expect(bloqueia(t)).toBe(true));

  it('resposta vazia não sai', () => {
    expect(bloqueia('   ')).toBe(true);
  });
});

describe('freio de saída · deixa passar', () => {
  it.each([
    'O senhor não precisa mandar CPF nem documento nenhum por aqui.',
    'Nunca peça PIX: ninguém precisa pagar nada pra vender precatório.',
    'Vi aqui que o seu processo é contra o Estado de Alagoas. Bate com o seu?',
    'O senhor é casado? Pergunto porque, se for, o cônjuge também assina.',
    'Já assinou algum papel com outra empresa sobre esse processo?',
    'Ganhou em 2019? Então o processo já terminou.',
    'Vou chamar uma pessoa da equipe pra continuar com o senhor.',
  ])('%s', (t) => expect(verificarSaida(t)).toEqual({ ok: true }));

  it('a negação só vale na própria frase', () => {
    // "não" na primeira frase não pode perdoar o pedido na segunda.
    expect(bloqueia('Não se preocupe. Me manda seu CPF.')).toBe(true);
  });

  it('os textos fixos do freio de entrada passam no de saída', () => {
    // Os dois freios têm que concordar: o texto que o código manda pronto não
    // pode ser barrado pelo próprio código.
    expect(verificarSaida(RESPOSTA_RECUSA_PRECO)).toEqual({ ok: true });
    expect(verificarSaida(RESPOSTA_SUSPEITA_GOLPE)).toEqual({ ok: true });
  });
});
