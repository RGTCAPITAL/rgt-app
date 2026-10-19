/**
 * Limites do cálculo que mais de uma camada precisa conhecer.
 *
 * ESTE ARQUIVO NÃO IMPORTA NADA, de propósito.
 *
 * A constante abaixo nasceu dentro de `correcao.ts`, e movê-la pra cá não foi
 * organização: `correcao.ts` importa `lib/supabase/server`, que importa
 * `next/headers`. Quando o painel de índices (componente cliente) importou o
 * limite de lá pra não duplicar o número, arrastou o cliente Supabase do
 * servidor pro bundle do navegador e a página quebrou com HTTP 500 — com
 * `tsc --noEmit` limpo e a suíte verde.
 *
 * Qualquer constante que servidor e cliente compartilhem entra aqui. Adicionar
 * um import neste arquivo reabre aquele caminho.
 */

/**
 * Quantos meses de atraso uma série de índice pode ter antes de a precificação
 * recusar o cálculo.
 *
 * Dois e não um porque o índice de um mês só é publicado no mês seguinte:
 * pedir correção "até hoje" SEMPRE vai faltar o mês corrente. Com limite de
 * um, a tela não funcionaria nunca.
 *
 * Dois consumidores, de lados opostos:
 *  - `obterFatorCorrecao` usa pra RECUSAR o cálculo;
 *  - `avaliarFrescor` usa pra AVISAR antes de a recusa acontecer.
 *
 * Duplicar este número faria o painel dizer "em dia" no mesmo dia em que a
 * precificação começa a recusar — e ninguém ligaria as duas coisas.
 */
export const LIMITE_ATRASO_MESES = 2;
