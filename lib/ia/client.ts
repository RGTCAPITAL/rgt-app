/**
 * Cliente da Anthropic pra leitura de documentos.
 *
 * Mesma regra da Judit: cada chamada custa dinheiro, então só sai de server
 * action com `exigirPerfil` antes. NÃO importar de client component — a chave
 * vive só no servidor.
 */

import Anthropic from '@anthropic-ai/sdk';

/**
 * Opus 5 lê PDF escaneado direto (vision), o que importa aqui: metade dos
 * ofícios que chegam é foto de papel, não PDF de texto.
 */
export const MODELO_EXTRACAO = 'claude-opus-5';

/** 10MB. A API aceita request de até 32MB, mas base64 infla ~33% e ofício
 *  legítimo não passa disso — arquivo maior costuma ser autos inteiros. */
export const TAMANHO_MAX_BYTES = 10 * 1024 * 1024;

export class IAError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'IAError';
  }
}

export function iaConfigurada(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let cliente: Anthropic | null = null;

export function getCliente(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new IAError('ANTHROPIC_API_KEY não configurada no ambiente');
  }
  cliente ??= new Anthropic();
  return cliente;
}
