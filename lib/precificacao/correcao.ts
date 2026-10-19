/**
 * Ponte entre a cascata e o motor de índices.
 *
 * O `calcularFator` existe desde setembro, com 6 séries, 2.521 pontos
 * históricos e 19 testes — e nunca teve um chamador em produção. Este arquivo
 * é o que o liga: busca a série que o ofício manda aplicar, no intervalo que
 * interessa, e devolve o fator pronto pra cascata multiplicar.
 *
 * Mora separado de `cascata.ts` de propósito: a cascata é pura e testável sem
 * banco; aqui é onde o I/O acontece. Quem precisar simular uma correção num
 * teste passa o fator direto, sem subir Postgres.
 */

import { createClient } from '@/lib/supabase/server';
import { calcularFator, competenciaDe, type PontoPersistido } from '@/lib/indices/fator';
import type { Serie } from '@/lib/indices/series';
import { LIMITE_ATRASO_MESES } from './limites';

// Reexportado pra quem já importava daqui. A definição mora em `limites.ts`,
// que não importa nada — este arquivo puxa `next/headers` por tabela, e um
// componente cliente que importasse a constante daqui quebraria a página.
export { LIMITE_ATRASO_MESES };

export type ResultadoCorrecao =
  | {
      ok: true;
      fator: number;
      metodo: 'numero_indice' | 'encadeamento';
      mesesAplicados: number;
      /** Competência até a qual a correção foi de fato aplicada. */
      competenciaFinal: string;
      /**
       * True quando a série ainda não alcançou a data pedida e a conta parou
       * na última competência publicada. Não é erro — é o normal.
       */
      truncadoNaUltima: boolean;
    }
  | { ok: false; erro: string; serieDefasada?: boolean };

/**
 * Fator de correção entre a data-base do ofício e a data final.
 *
 * Busca só o intervalo necessário em vez da série inteira: um precatório de
 * 2024 não precisa carregar 46 anos de IPCA pra corrigir 20 meses.
 */
export async function obterFatorCorrecao(
  serie: Serie,
  dataBaseIso: string,
  dataFinalIso: string,
): Promise<ResultadoCorrecao> {
  const supabase = await createClient();

  const competenciaBase = competenciaDe(dataBaseIso);
  const competenciaFinal = competenciaDe(dataFinalIso);

  const { data, error } = await supabase
    .from('indices_economicos')
    .select('competencia, variacao_pct, numero_indice')
    .eq('serie', serie)
    .gte('competencia', competenciaBase)
    .lte('competencia', competenciaFinal)
    .order('competencia')
    .returns<PontoPersistido[]>();

  if (error) {
    console.error('[precificacao] falha ao ler série', serie, error);
    return { ok: false, erro: 'Não foi possível ler os índices. Tente de novo.' };
  }

  const pontos = data ?? [];
  if (pontos.length === 0) {
    return {
      ok: false,
      erro: `A série ${serie.toUpperCase()} não tem nenhum ponto entre ${competenciaBase.slice(0, 7)} e ${competenciaFinal.slice(0, 7)}. Sincronize os índices antes de precificar.`,
      serieDefasada: true,
    };
  }

  // O índice de um mês só é publicado no mês seguinte: em 19/10 a série ainda
  // está fechada em setembro. Pedir correção "até hoje" portanto SEMPRE vai
  // faltar o mês corrente — se isso fosse erro, a tela não funcionaria nunca.
  //
  // Então a conta vai até a última competência publicada e diz até onde foi,
  // que é exatamente como a contadoria judicial trabalha ("atualizado até
  // 09/2026"). O que não pode é a série estar meses atrás sem ninguém saber:
  // aí o fator sai menor que o real e vira proposta abaixo do valor.
  const ultima = pontos[pontos.length - 1]!.competencia;
  const atraso = ultima < competenciaFinal ? mesesEntre(ultima, competenciaFinal) : 0;

  if (atraso > LIMITE_ATRASO_MESES) {
    return {
      ok: false,
      erro: `A série ${serie.toUpperCase()} está parada em ${formatarCompetencia(ultima)} e já deveria alcançar ${formatarCompetencia(competenciaFinal)}. Corrigir assim produziria um valor menor que o real. Sincronize os índices antes de precificar.`,
      serieDefasada: true,
    };
  }

  // Corrige até onde a série alcança, não até onde foi pedido.
  const alvoEfetivo = atraso > 0 ? ultima : dataFinalIso;
  const r = calcularFator(pontos, dataBaseIso, alvoEfetivo);
  if (!r.ok) return { ok: false, erro: r.erro };

  return {
    ok: true,
    fator: r.fator,
    metodo: r.metodo,
    mesesAplicados: r.mesesAplicados,
    competenciaFinal: ultima,
    truncadoNaUltima: atraso > 0,
  };
}

/** '2026-09-01' → '09/2026' */
function formatarCompetencia(competencia: string): string {
  return `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;
}

/** Distância em meses entre duas competências (dia 1). */
function mesesEntre(de: string, ate: string): number {
  const [anoDe, mesDe] = de.split('-').map(Number);
  const [anoAte, mesAte] = ate.split('-').map(Number);
  return (anoAte! - anoDe!) * 12 + (mesAte! - mesDe!);
}
