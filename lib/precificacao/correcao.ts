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

export type ResultadoCorrecao =
  | {
      ok: true;
      fator: number;
      metodo: 'numero_indice' | 'encadeamento';
      mesesAplicados: number;
      /** Última competência disponível na série — mostra o quão atual é a conta. */
      competenciaFinal: string;
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

  // Defasagem é o caso perigoso: a série existe, o cálculo "funciona", e o
  // fator sai menor do que deveria porque faltam os meses do fim. Isso vira
  // proposta abaixo do valor — dinheiro deixado na mesa sem ninguém notar.
  const ultima = pontos[pontos.length - 1]!.competencia;
  if (ultima < competenciaFinal) {
    const faltam = mesesEntre(ultima, competenciaFinal);
    // Um mês de atraso é normal: índice de outubro só sai em novembro.
    if (faltam > 1) {
      return {
        ok: false,
        erro: `A série ${serie.toUpperCase()} está atualizada até ${ultima.slice(0, 7)}, faltando ${faltam} ${faltam === 1 ? 'mês' : 'meses'} até ${competenciaFinal.slice(0, 7)}. Corrigir com a série incompleta produziria um valor menor que o real.`,
        serieDefasada: true,
      };
    }
  }

  const r = calcularFator(pontos, dataBaseIso, dataFinalIso);
  if (!r.ok) return { ok: false, erro: r.erro };

  return {
    ok: true,
    fator: r.fator,
    metodo: r.metodo,
    mesesAplicados: r.mesesAplicados,
    competenciaFinal: ultima,
  };
}

/** Distância em meses entre duas competências (dia 1). */
function mesesEntre(de: string, ate: string): number {
  const [anoDe, mesDe] = de.split('-').map(Number);
  const [anoAte, mesAte] = ate.split('-').map(Number);
  return (anoAte! - anoDe!) * 12 + (mesAte! - mesDe!);
}
