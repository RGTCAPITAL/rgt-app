export const ETAPAS_FLUXO = [
  { value: 'precificacao', label: 'Precificação' },
  { value: 'aceite', label: 'Aceite' },
  { value: 'due_diligence_juridica', label: 'DD Jurídica' },
  { value: 'due_diligence_fiscal', label: 'DD Fiscal' },
  { value: 'analise_investimento', label: 'Análise Investimento' },
  { value: 'cartorio', label: 'Cartório' },
  { value: 'pagamento', label: 'Pagamento' },
  { value: 'finalizada', label: 'Finalizada' },
] as const;

export type EtapaFluxo = (typeof ETAPAS_FLUXO)[number]['value'];

export function labelEtapa(v: string): string {
  if (v === 'cancelada') return 'Cancelada';
  return ETAPAS_FLUXO.find((e) => e.value === v)?.label ?? v;
}

export function indiceEtapa(v: string): number {
  return ETAPAS_FLUXO.findIndex((e) => e.value === v);
}

export type Etapa = EtapaFluxo | 'cancelada';

/**
 * Devolve as etapas pras quais a operação pode transitar a partir da atual.
 * Regras:
 * - De qualquer etapa não-terminal: pode avançar pra próxima do fluxo
 * - De qualquer etapa não-terminal: pode voltar pra anterior (correção)
 * - De qualquer etapa não-terminal: pode cancelar
 * - Etapas terminais (finalizada, cancelada): sem transições
 * - Bloqueio duro: sair de `aceite` pra `due_diligence_juridica` exige preco_aceito = true
 *   (não retornado aqui — a action valida antes do UPDATE)
 */
export function transicoesPermitidas(atual: string): Etapa[] {
  if (atual === 'finalizada' || atual === 'cancelada') return [];

  const idx = indiceEtapa(atual);
  const opcoes: Etapa[] = [];

  if (idx >= 0 && idx < ETAPAS_FLUXO.length - 1) {
    opcoes.push(ETAPAS_FLUXO[idx + 1].value);
  }
  if (idx > 0) {
    opcoes.push(ETAPAS_FLUXO[idx - 1].value);
  }
  opcoes.push('cancelada');

  return opcoes;
}
