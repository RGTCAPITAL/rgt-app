/**
 * Extrai red flags de uma resposta Judit. Cada red flag vira badge vermelho
 * na UI + fica em operacoes.dd_judit_red_flags pro Robson filtrar depois.
 *
 * A lógica exata depende do formato real da resposta — ajustar quando doc
 * chegar. Por ora, heurísticas defensivas cobrindo os casos que a RGT
 * já sabe que quebram operação (ver anti-objetivos do Renato).
 */

import type { PayloadJudit, ProcessoJudit, RedFlag } from './types';

function isProcesso(payload: PayloadJudit): payload is ProcessoJudit {
  return typeof payload === 'object' && payload !== null && 'numero_cnj' in payload;
}

export function extrairRedFlags(payload: PayloadJudit): RedFlag[] {
  const flags: RedFlag[] = [];

  if (!payload || Object.keys(payload).length === 0) {
    return ['nao_encontrado'];
  }

  if (!isProcesso(payload)) {
    // Formato inesperado — trata como não encontrado
    return ['nao_encontrado'];
  }

  // Não transitou em julgado → RGT não compra
  if (payload.transitou_em_julgado === false) {
    flags.push('nao_transitou');
  }

  // Tem penhora ativa → risco de disputa
  if (payload.penhoras && payload.penhoras.length > 0) {
    flags.push('tem_penhora');
  }

  // Já cedido a outro → não pode comprar de novo
  if (payload.cessoes && payload.cessoes.length > 0) {
    flags.push('outro_cessionario');
  }

  // Autor sem advogado (raro mas complica) — só se explicitamente ausente
  const autor = payload.partes?.find((p) => p.tipo === 'autor');
  if (autor && (!autor.advogados || autor.advogados.length === 0)) {
    flags.push('sem_advogado');
  }

  // Sem movimentação há +6 meses → processo parado, risco
  if (payload.data_ultimo_movimento) {
    const seisMesesMs = 180 * 24 * 60 * 60 * 1000;
    const diff = Date.now() - new Date(payload.data_ultimo_movimento).getTime();
    if (diff > seisMesesMs) {
      flags.push('sem_movimentacao_recente');
    }
  }

  return flags;
}
