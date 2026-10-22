/**
 * A data de hoje no Brasil, em ISO (YYYY-MM-DD).
 *
 * `new Date().toISOString().slice(0, 10)` dá a data em UTC, que vira o dia às
 * 21h em Maceió. No painel de deságio isso fazia uma vigência marcada pra
 * amanhã aparecer valendo na noite de hoje (achado 2 da revisão da RGT-96).
 *
 * `agora` entra por parâmetro pra dar pra testar a virada do dia.
 */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  // en-CA formata como YYYY-MM-DD, que é exatamente o ISO de data.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}
