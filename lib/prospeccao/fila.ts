/**
 * Fila de ligação do broker em /admin/prospeccao.
 *
 * A tabela crua mostra os 128 precatórios do TRT19 por valor, misturando o que
 * dá pra ligar hoje com o que já foi cedido, penhorado ou pago. O broker
 * precisa de outra pergunta respondida: "por onde eu começo?". Este módulo
 * separa as linhas em três blocos e diz, quando há, o próximo passo de cada
 * uma — sem esconder nada.
 *
 * Funções puras, sem React nem Supabase: a página (server) e a tabela
 * (client) consomem o mesmo critério, e o critério é testável sozinho.
 */

import { temAlertaGrave } from '@/lib/djen/red-flags';

export type GrupoFila = 'oficio' | 'outros' | 'conferir';
export type VisaoProspeccao = 'fila' | 'todos';

/**
 * Status que ainda pedem ação do broker. `lead_criado` já virou lead no CRM e
 * `descartado` foi tirado da mesa por alguém — mostrar os dois na fila só
 * faria o broker ligar de novo pra quem já foi tratado. Na visão "todos"
 * eles continuam aparecendo.
 */
export const STATUS_NA_FILA = ['importado', 'enriquecido', 'em_prospeccao'] as const;

/**
 * Qual visão abrir. Parâmetro explícito na URL sempre vale (o link é
 * compartilhável e o admin pode querer ver a fila do broker). Sem parâmetro,
 * o broker cai na fila, que é o trabalho dele; admin e gestão caem em "todos",
 * que é o que eles usam pra auditar a importação e o enriquecimento.
 * Valor desconhecido na URL é tratado como ausente, em vez de quebrar a página.
 */
export function resolverVisao(
  param: string | undefined,
  role: string | undefined,
): VisaoProspeccao {
  if (param === 'fila' || param === 'todos') return param;
  return role === 'broker' ? 'fila' : 'todos';
}

/**
 * Em qual bloco a linha entra.
 *
 *   - conferir: tem alerta grave (cessão, FIDC, penhora, pagamento). Vem
 *     primeiro no teste porque um ofício citado não anula uma cessão.
 *   - oficio:   o DJEN citou o ofício requisitório (X1) — o precatório existe
 *     e está na fila de pagamento, que é o que o comprador quer.
 *   - outros:   o resto.
 */
export function grupoFila(row: { red_flags: readonly string[] }): GrupoFila {
  if (temAlertaGrave(row.red_flags)) return 'conferir';
  if (row.red_flags.includes('X1')) return 'oficio';
  return 'outros';
}

/**
 * Ordem dos blocos na tela.
 *
 * 'outros' fica logo depois do ofício e NÃO some nem colapsa: os dois maiores
 * valores da base (R$ 3,6 mi e R$ 3,1 mi, medido em 2026-10-23) não têm X1.
 * Todos os 128 vieram da planilha de precatórios do tribunal; a ausência do
 * X1 só quer dizer que as publicações recentes do DJEN não repetiram o ofício.
 *
 * 'conferir' vai pro fim mas continua visível: o alerta é detectado por texto
 * e cessão pode ser parcial (o terceiro maior valor da base tem cessão com
 * percentual) — parte do crédito ainda pode ser do credor e comprável.
 */
export const ORDEM_GRUPO: Record<GrupoFila, number> = {
  oficio: 0,
  outros: 1,
  conferir: 2,
};

/** Os grupos já na ordem de exibição, pra a UI montar os blocos num loop. */
export const GRUPOS_EM_ORDEM: readonly GrupoFila[] = (Object.keys(ORDEM_GRUPO) as GrupoFila[]).sort(
  (a, b) => ORDEM_GRUPO[a] - ORDEM_GRUPO[b],
);

/**
 * Cabeçalho de cada bloco. O subtítulo diz o que o broker faz com o bloco,
 * não como o sistema classificou — quem lê é quem vai ligar.
 */
export const GRUPO_TEXTO: Record<GrupoFila, { titulo: string; subtitulo: string }> = {
  oficio: {
    titulo: 'Ofício citado no DJEN',
    subtitulo: 'Sem alerta grave. Comece por aqui, do maior valor pro menor.',
  },
  outros: {
    titulo: 'Outros precatórios sem alerta grave',
    subtitulo:
      'Também estão na planilha do tribunal; o DJEN só não citou o ofício nas publicações recentes.',
  },
  conferir: {
    titulo: 'Conferir antes de ligar',
    subtitulo:
      'Provável cessão, FIDC, penhora ou pagamento. Abra o processo no PJe e veja quanto ainda é do credor antes de qualquer contato.',
  },
};

/**
 * Reordena por bloco sem mexer na ordem dentro de cada um. O servidor já
 * entrega por valor desc, então dentro do bloco a linha mais valiosa continua
 * no topo. Feito por baldes (um passe, ordem de chegada preservada) em vez de
 * reordenar por valor aqui: se o servidor mudar o critério, a fila acompanha.
 * Devolve array novo — não muta a entrada.
 */
export function ordenarParaFila<T extends { red_flags: readonly string[] }>(
  rows: readonly T[],
): T[] {
  const baldes: Record<GrupoFila, T[]> = { oficio: [], outros: [], conferir: [] };
  for (const row of rows) baldes[grupoFila(row)].push(row);
  return GRUPOS_EM_ORDEM.flatMap((g) => baldes[g]);
}

/**
 * Quantidade e soma de valor de face por bloco, pro cabeçalho de cada um.
 * Os três grupos sempre vêm, mesmo vazios, pra a UI não tratar chave faltando.
 * Valor nulo conta na quantidade (o precatório existe) mas soma zero.
 */
export function resumoGrupos(
  rows: readonly { red_flags: readonly string[]; valor_face: number | null }[],
): Record<GrupoFila, { qtd: number; soma: number }> {
  const resumo: Record<GrupoFila, { qtd: number; soma: number }> = {
    oficio: { qtd: 0, soma: 0 },
    outros: { qtd: 0, soma: 0 },
    conferir: { qtd: 0, soma: 0 },
  };
  for (const row of rows) {
    const r = resumo[grupoFila(row)];
    r.qtd += 1;
    r.soma += row.valor_face ?? 0;
  }
  return resumo;
}

/**
 * "(ESPÓLIO)" no fim do nome do credor. Aceita sem acento, minúsculas e a
 * forma "(ESPÓLIO DE)" que o cabeçalho do PJe usa ("NOME (ESPÓLIO DE) E
 * OUTROS (3)"), caso o nome chegue sem normalizar.
 */
const RE_NOME_ESPOLIO = /\(\s*esp[óo]lio(?:\s+de)?\s*\)\s*$/i;

/**
 * Uma frase de ação pra linha, ou null quando não há nada fora do normal —
 * a linha comum fica limpa, senão o aviso vira ruído e ninguém lê.
 *
 * A prioridade segue o que trava a ligação primeiro:
 *   1. alerta grave: ligar pra quem já cedeu é perder tempo e queimar a RGT;
 *      e como cessão pode ser parcial, o PJe diz quanto sobrou.
 *   2. espólio: o credor morreu, quem negocia é o inventariante/herdeiros.
 *   3. DJEN achou publicação mas não o credor: o advogado do processo é a
 *      porta de entrada. (Não citamos o advogado da linha pelo nome porque em
 *      parte da base ele é o advogado do devedor.)
 *   4. extinção citada: quase sempre texto padrão do TRT19 antes do
 *      pagamento, mas pode ser prescrição intercorrente — vale ler antes.
 */
export function proximoPasso(row: {
  red_flags: readonly string[];
  cedente_nome_provavel: string | null;
  advogado_nome: string | null;
  judit_status: string;
}): string | null {
  if (temAlertaGrave(row.red_flags)) {
    return 'Veja no PJe quanto ainda é do credor antes de ligar.';
  }
  const cedente = row.cedente_nome_provavel?.trim() ?? '';
  if (row.red_flags.includes('7') || RE_NOME_ESPOLIO.test(cedente)) {
    return 'Espólio: procure o inventariante ou os herdeiros habilitados.';
  }
  // judit_status é a coluna herdada da Judit; hoje quem grava é o batch do
  // DJEN, e 'ok' quer dizer que achou publicação do processo.
  if (row.judit_status === 'ok' && !cedente) {
    return 'Procure no PJe quem é o credor ou o advogado dele.';
  }
  if (row.red_flags.includes('4e')) {
    return 'Leia no PJe a decisão de extinção antes de ligar.';
  }
  return null;
}
