/**
 * Quão atual está uma série, e quando ela vai travar a precificação.
 *
 * Existe porque a resposta pra "como eu sei que os índices estão atualizados?"
 * não pode ser "abra o banco". A tabela de `/admin/indices` já recebia
 * `coletado_em` da RPC, e nunca o mostrava — o campo era morto ponta a ponta.
 *
 * O NÚMERO QUE IMPORTA NÃO É "COLETADO HÁ N DIAS". É a data em que a
 * precificação para. `obterFatorCorrecao` RECUSA corrigir quando a série está
 * atrasada mais de `LIMITE_ATRASO_MESES`, e essa recusa aparece como um erro
 * numa tela de precificação, longe daqui, semanas depois. O aviso tem que vir
 * antes, no lugar onde alguém pode agir.
 *
 * Função pura e sem relógio: `hojeIso` entra por parâmetro. Num componente
 * cliente, `new Date()` roda no fuso do navegador e pode discordar do servidor
 * na virada do mês — justamente quando o aviso mais importa.
 */

import { LIMITE_ATRASO_MESES } from '@/lib/precificacao/limites';

export type NivelFrescor = 'ok' | 'atencao' | 'travado' | 'vazia';

export type Frescor = {
  nivel: NivelFrescor;
  /** Quantos meses a série está atrás do mês corrente. */
  atrasoMeses: number;
  /** Competência em que a precificação passa a recusar esta série. */
  travaEm: string | null;
  /** Frase curta pra tabela. */
  rotulo: string;
  /** Contexto, pra quem quiser entender o porquê. */
  detalhe: string;
};

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** '2026-09-01' → 'set/2026' */
export function fmtCompetencia(competencia: string): string {
  return `${MESES[Number(competencia.slice(5, 7)) - 1]}/${competencia.slice(0, 4)}`;
}

function somarMeses(competencia: string, meses: number): string {
  const total =
    Number(competencia.slice(0, 4)) * 12 + (Number(competencia.slice(5, 7)) - 1) + meses;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

function mesesEntre(de: string, ate: string): number {
  return (
    (Number(ate.slice(0, 4)) - Number(de.slice(0, 4))) * 12 +
    (Number(ate.slice(5, 7)) - Number(de.slice(5, 7)))
  );
}

/**
 * Dias de CALENDÁRIO entre a coleta e hoje, em UTC.
 *
 * Calendário e não horas decorridas: uma coleta de ontem às 20h está a 4 horas
 * da meia-noite de hoje, e contar horas a rotularia como "hoje". Quem lê a
 * tabela pensa em dias do calendário, não em múltiplos de 24 h.
 */
export function diasDesde(coletadoEmIso: string, hojeIso: string): number {
  const d = new Date(coletadoEmIso);
  if (Number.isNaN(d.getTime())) return 0;
  const diaDaColeta = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diaDeHoje = Date.parse(`${hojeIso}T00:00:00Z`);
  return Math.max(0, Math.round((diaDeHoje - diaDaColeta) / 86_400_000));
}

export function avaliarFrescor(
  ultimaCompetencia: string | null,
  coletadoEm: string | null,
  hojeIso: string,
): Frescor {
  if (!ultimaCompetencia) {
    return {
      nivel: 'vazia',
      atrasoMeses: 0,
      travaEm: null,
      rotulo: 'nunca coletada',
      detalhe: 'A precificação recusa qualquer crédito que dependa desta série.',
    };
  }

  const competenciaHoje = `${hojeIso.slice(0, 7)}-01`;
  const atrasoMeses = Math.max(0, mesesEntre(ultimaCompetencia, competenciaHoje));

  // Trava quando o atraso PASSA do limite — então a primeira competência ruim
  // é a que deixa o atraso em LIMITE + 1.
  const travaEm = somarMeses(ultimaCompetencia, LIMITE_ATRASO_MESES + 1);

  const nivel: NivelFrescor =
    atrasoMeses > LIMITE_ATRASO_MESES
      ? 'travado'
      : atrasoMeses === LIMITE_ATRASO_MESES
        ? 'atencao'
        : 'ok';

  const quando = coletadoEm ? diasDesde(coletadoEm, hojeIso) : null;
  const rotulo =
    quando === null
      ? fmtCompetencia(ultimaCompetencia)
      : quando === 0
        ? 'hoje'
        : quando === 1
          ? 'ontem'
          : `há ${quando} dias`;

  const detalhe =
    nivel === 'travado'
      ? `A precificação JÁ recusa esta série: parada em ${fmtCompetencia(ultimaCompetencia)}, ` +
        `com ${atrasoMeses} meses de atraso. Sincronize.`
      : nivel === 'atencao'
        ? `Último mês antes de travar. Em ${fmtCompetencia(travaEm)} a precificação ` +
          `passa a recusar esta série.`
        : `Em dia até ${fmtCompetencia(ultimaCompetencia)}. Travaria em ${fmtCompetencia(travaEm)} ` +
          `se parasse de atualizar.`;

  return { nivel, atrasoMeses, travaEm, rotulo, detalhe };
}
