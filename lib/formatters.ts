/**
 * Formata data ISO (yyyy-mm-dd OU timestamp) sem sofrer com timezone.
 *
 * Problema clássico: Postgres retorna coluna `date` como string 'yyyy-mm-dd'.
 * `new Date('2020-01-01')` parseia como UTC midnight. Em UTC-3, isso
 * renderiza como 31/12/2019 21:00 → toLocaleDateString mostra dia anterior.
 *
 * Fix: se detectar `yyyy-mm-dd` puro (sem 'T'), monta Date com componentes
 * locais em vez de parse UTC. Timestamp com 'T' segue o comportamento
 * nativo (é um instante real, não uma data solta).
 */
export function fmtDataBR(iso: string | null | undefined): string {
  if (!iso) return '—';

  // Date-only (yyyy-mm-dd): monta em timezone local pra evitar shift
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    return `${d}/${m}/${y}`;
  }

  // Timestamp completo (2026-09-02T13:45:00Z): mantém comportamento local
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR');
}

export function fmtDataHoraBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR');
}

/**
 * Title Case pra nome de pessoa/empresa.
 * Preserva conectivos minúsculos comuns em pt-BR (de, da, do, das, dos, e).
 * Ex: "pedro da silva" → "Pedro da Silva"
 */
export function titleCase(v: string): string {
  const lower = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du']);
  return v
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => {
      if (i > 0 && lower.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

