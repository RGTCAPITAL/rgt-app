/**
 * A data de hoje no Brasil, em ISO (YYYY-MM-DD).
 *
 * `new Date().toISOString().slice(0, 10)` dá a data em UTC, que vira o dia às
 * 21h em Maceió. No painel de deságio isso fazia uma vigência marcada pra
 * amanhã aparecer valendo na noite de hoje (achado 2 da revisão da RGT-96).
 *
 * `agora` entra por parâmetro pra dar pra testar a virada do dia.
 */
/**
 * Soma dias a uma data ISO (YYYY-MM-DD), sem passar por fuso nenhum.
 *
 * Feito em UTC de propósito: a data entra e sai como dia de calendário, então
 * o horário de verão ou o fuso de quem roda não podem empurrar pro dia errado.
 */
export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  // en-CA formata como YYYY-MM-DD, que é exatamente o ISO de data.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}
