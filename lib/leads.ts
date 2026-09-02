export const STATUS_LEAD = [
  {
    value: 'novo',
    label: 'Novo',
    cor: 'bg-neutral-100 text-neutral-800',
    corVazio: 'bg-neutral-50 text-neutral-500',
  },
  {
    value: 'em_contato',
    label: 'Em contato',
    cor: 'bg-blue-100 text-blue-800',
    corVazio: 'bg-neutral-50 text-neutral-500',
  },
  {
    value: 'qualificado',
    label: 'Qualificado',
    cor: 'bg-amber-100 text-amber-800',
    corVazio: 'bg-neutral-50 text-neutral-500',
  },
  {
    value: 'proposta_enviada',
    label: 'Proposta enviada',
    cor: 'bg-purple-100 text-purple-800',
    corVazio: 'bg-neutral-50 text-neutral-500',
  },
  {
    value: 'ganho',
    label: 'Ganho',
    cor: 'bg-emerald-100 text-emerald-800',
    corVazio: 'bg-neutral-50 text-neutral-500',
  },
  {
    value: 'perdido',
    label: 'Perdido',
    cor: 'bg-red-100 text-red-800',
    corVazio: 'bg-neutral-50 text-neutral-500',
  },
] as const;

export type StatusLead = (typeof STATUS_LEAD)[number]['value'];

export const ORIGEM_LEAD = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'site', label: 'Site' },
  { value: 'indicacao', label: 'Indicação' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'evento', label: 'Evento' },
  { value: 'outro', label: 'Outro' },
] as const;

export type OrigemLead = (typeof ORIGEM_LEAD)[number]['value'];

export function labelStatus(v: string): string {
  return STATUS_LEAD.find((s) => s.value === v)?.label ?? v;
}

export function labelOrigem(v: string): string {
  return ORIGEM_LEAD.find((o) => o.value === v)?.label ?? v;
}
