import { palavra } from '../guardrails';

/**
 * Freio de saída: confere o texto que a IA escreveu ANTES de ir pro WhatsApp.
 *
 * O freio de entrada (`guardrails.ts`) impede a IA de ver a pergunta de preço.
 * Este cobre o outro lado: a IA puxar o assunto sozinha, ou escorregar num
 * exemplo ("tem gente que recebe 70% à vista"). Art. 30 do CDC não pergunta
 * quem começou. Prompt pede, código garante.
 *
 * Falso positivo aqui custa pouco — a conversa vai pro broker com o motivo.
 * Falso negativo é a oferta vinculante que o projeto inteiro existe pra evitar.
 */

export type ResultadoFreioSaida = { ok: true } | { ok: false; motivo: string };

interface Regra {
  motivo: string;
  re: RegExp;
  /**
   * A regra perdoa a frase quando ela é uma negação ("não mande CPF").
   * Só faz sentido onde o robô deve, ativamente, falar a palavra proibida.
   */
  perdoaNegacao?: boolean;
}

const REGRAS: Regra[] = [
  {
    motivo: 'citou valor, percentual ou moeda',
    // O `(?!\d)` no fim do "123.456": sem ele, o robô repetindo o número do
    // processo ("0700123-45.2019.8...") casava "45.201" como dinheiro e a
    // conversa ia pro broker à toa. Visto no simulador em 28/10.
    re: palavra(
      /(R\$|\d+([.,]\d+)?\s*%|por cento|reais|\d+\s*mil\b|milh[ãa]o|milh[õo]es|\d{1,3}(\.\d{3})+(,\d{2})?(?!\d))/,
    ),
  },
  {
    motivo: 'falou em deságio ou desconto',
    re: palavra(/(des[áa]gio|desconto de|[àa] vista por|pagamos|oferecemos|proposta de)/),
  },
  {
    motivo: 'prometeu prazo',
    re: palavra(
      /(\d+\s*(dias?|semanas?|meses|m[êe]s)|at[ée] (amanh[ãa]|sexta|segunda)|essa semana|semana que vem|na hora|imediatamente)/,
    ),
  },
  {
    // O robô deve DIZER que não precisa mandar documento — a negação é
    // permitida. O que não pode é pedir.
    motivo: 'pediu documento ou dado bancário',
    re: palavra(
      /(cpf|rg\b|identidade|dados banc|conta banc|ag[êe]ncia|chave pix|\bpix\b|senha|c[óo]digo de verifica|foto do (seu )?documento|comprovante)/,
    ),
    perdoaNegacao: true,
  },
  {
    // Quem diz "não somos golpe" é golpista. A resposta certa é dar meio de
    // verificar, não se defender.
    motivo: 'se defendeu de golpe',
    re: palavra(
      /(n[ãa]o (somos|[ée]) golpe|n[ãa]o (somos|sou) golpista|pode confiar em mim|somos de confian[çc]a)/,
    ),
  },
  {
    motivo: 'criou urgência',
    re: palavra(
      /(s[óo] (at[ée]|hoje)|[úu]ltima chance|v[áa]lid[ao] at[ée]|corra|urgente|garantid[ao]|aproveite|vagas limitadas)/,
    ),
  },
  {
    motivo: 'fingiu ser humano',
    re: palavra(
      /(sou (um |uma )?(humano|pessoa de verdade|atendente humano)|n[ãa]o sou (um )?rob[ôo])/,
    ),
  },
];

const NEGACAO = palavra(/(n[ãa]o|nunca|nenhum|nenhuma|jamais|nem)/);

/** Quebra em frases pra a negação valer só dentro da própria frase. */
function frases(texto: string): string[] {
  return texto.split(/(?<=[.!?\n])\s+/).filter(Boolean);
}

export function verificarSaida(texto: string): ResultadoFreioSaida {
  if (!texto.trim()) return { ok: false, motivo: 'resposta vazia' };

  for (const regra of REGRAS) {
    for (const frase of frases(texto)) {
      if (!regra.re.test(frase)) continue;
      if (regra.perdoaNegacao && NEGACAO.test(frase)) continue;
      return { ok: false, motivo: regra.motivo };
    }
  }
  return { ok: true };
}
