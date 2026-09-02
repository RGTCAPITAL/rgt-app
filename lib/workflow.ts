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
