/**
 * Extrai metadados úteis do payload Judit pra popular prospeccao_precatorios:
 * nome do cedente (autor do processo), CPF, advogado + OAB.
 *
 * Isso alimenta a fila de prospecção: broker vê o nome e vai atrás do contato.
 */

import type { PayloadJudit, ProcessoJudit } from './types';

export type MetadadosProspeccao = {
  cedenteNome: string | null;
  cedenteCpf: string | null;
  advogadoNome: string | null;
  advogadoOab: string | null;
};

function isProcesso(payload: PayloadJudit): payload is ProcessoJudit {
  return typeof payload === 'object' && payload !== null && 'numero_cnj' in payload;
}

export function extrairMetadadosProspeccao(payload: PayloadJudit): MetadadosProspeccao {
  const vazio: MetadadosProspeccao = {
    cedenteNome: null,
    cedenteCpf: null,
    advogadoNome: null,
    advogadoOab: null,
  };
  if (!isProcesso(payload)) return vazio;

  const autor = payload.partes?.find((p) => p.tipo === 'autor');
  if (!autor) return vazio;

  const advogado = autor.advogados?.[0];

  return {
    cedenteNome: autor.nome ?? null,
    cedenteCpf: autor.cpf_cnpj ?? null,
    advogadoNome: advogado?.nome ?? null,
    advogadoOab: advogado?.oab ?? null,
  };
}
