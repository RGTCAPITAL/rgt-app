'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { exigirPerfil } from '@/lib/auth/roles';
import { consolidarProcesso, peritosCitados } from '@/lib/djen/consolidar';
import { mapCruParaPublicacao } from '@/lib/djen/mappers';
import type { Publicacao } from '@/lib/djen/types';
import type { DjenItem } from '@/lib/djen/types.raw';
import {
  calcularDiffs,
  hashDiff,
  montarAtualizacoes,
  resumirDiffs,
  type AtualizacaoLinha,
  type LinhaDiff,
  type LinhaProspeccaoAtual,
  type ProcessoConsolidado,
  type ResumoDiff,
} from '@/lib/prospeccao/reconsolidar';

/** Linhas por request no `.range`. Abaixo do teto de 1000 do PostgREST, com folga. */
const PAGINA = 500;
/**
 * Processos por `.in('numero_processo', ...)`. Cada CNJ são 20 dígitos na
 * URL; 100 por vez mantém a query curta mesmo se a fila crescer pra milhares.
 */
const PROCESSOS_POR_CONSULTA = 100;
/** Updates em paralelo. Pouco, pra não disputar conexão com a página aberta. */
const UPDATES_EM_PARALELO = 8;

/**
 * Só linhas que ainda não saíram da mão do broker. `em_prospeccao`,
 * `lead_criado` e `descartado` já tiveram gente olhando — o credor ali pode
 * ter sido corrigido à mão e não é o recálculo que vai desfazer.
 */
const STATUS_RECALCULAVEIS = ['importado', 'enriquecido'];

const ERRO_HASH = 'Os dados mudaram desde a simulação. Simule de novo.';

export type ResultadoReconsolidacao =
  | { ok: true; aplicado: false; diffs: LinhaDiff[]; hash: string; resumo: ResumoDiff }
  | {
      ok: true;
      aplicado: true;
      /** Linhas que o banco confirmou ter gravado. */
      atualizadas: number;
      /** Linhas que tinham alguma correção a aplicar. */
      esperadas: number;
      /** "processo: mensagem" de cada update que deu erro. */
      falhas: string[];
      resumo: ResumoDiff;
    }
  | { ok: false; error: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

type Pagina<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
}>;

/**
 * Lê uma consulta inteira de 500 em 500 e confere com o `count` exato. Se o
 * total lido não bate (alguém inseriu/apagou no meio, ou o PostgREST cortou),
 * aborta: diff calculado em cima de leitura parcial proporia apagar flag e
 * advogado de processo que só não veio na página.
 */
async function lerTudo<T>(
  consulta: (de: number, ate: number) => Pagina<T>,
  oQue: string,
): Promise<{ ok: true; linhas: T[] } | { ok: false; error: string }> {
  const linhas: T[] = [];
  let total: number | null = null;
  for (let de = 0; ; de += PAGINA) {
    const { data, error, count } = await consulta(de, de + PAGINA - 1);
    if (error) return { ok: false, error: `Erro lendo ${oQue}: ${error.message}` };
    if (count === null || (total !== null && count !== total)) {
      return {
        ok: false,
        error: `Leitura incompleta de ${oQue}: o total mudou durante a leitura.`,
      };
    }
    total = count;
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA || linhas.length >= total) break;
  }
  if (linhas.length !== total) {
    return {
      ok: false,
      error: `Leitura incompleta de ${oQue}: li ${linhas.length} de ${total}.`,
    };
  }
  return { ok: true, linhas };
}

/** Mais recente primeiro, igual a API devolve pro batch — a ordem das red flags gravadas sai igual. */
function porRecencia(a: Publicacao, b: Publicacao): number {
  if (a.dataDisponibilizacao !== b.dataDisponibilizacao) {
    return a.dataDisponibilizacao < b.dataDisponibilizacao ? 1 : -1;
  }
  return b.id - a.id;
}

type Calculo = {
  diffs: LinhaDiff[];
  hash: string;
  resumo: ResumoDiff;
  atualizacoes: AtualizacaoLinha[];
};

/**
 * Lê fila + publicações e monta o diff. Roda igual na simulação e na
 * aplicação — é isso que deixa o hash comparável entre as duas chamadas.
 */
async function calcular(
  supabase: Supabase,
): Promise<({ ok: true } & Calculo) | { ok: false; error: string }> {
  const fila = await lerTudo<LinhaProspeccaoAtual>(
    (de, ate) =>
      supabase
        .from('prospeccao_precatorios')
        .select(
          'id, numero_processo, valor_face, status, cedente_nome_provavel, advogado_nome, advogado_oab, red_flags',
          { count: 'exact' },
        )
        .eq('judit_status', 'ok')
        .in('status', STATUS_RECALCULAVEIS)
        .order('id')
        .range(de, ate),
    'prospeccao_precatorios',
  );
  if (!fila.ok) return fila;
  const linhas = fila.linhas;

  const processos = [...new Set(linhas.map((l) => l.numero_processo))].sort();
  const porProcesso = new Map<string, Publicacao[]>();
  let semRaw = 0;

  for (let i = 0; i < processos.length; i += PROCESSOS_POR_CONSULTA) {
    const fatia = processos.slice(i, i + PROCESSOS_POR_CONSULTA);
    const pubs = await lerTudo<{ numero_processo: string; raw: DjenItem | null }>(
      (de, ate) =>
        supabase
          .from('djen_publicacoes')
          .select('numero_processo, raw', { count: 'exact' })
          .in('numero_processo', fatia)
          .order('id')
          .range(de, ate),
      'djen_publicacoes',
    );
    if (!pubs.ok) return pubs;

    for (const linha of pubs.linhas) {
      if (!linha.raw) {
        semRaw++;
        continue;
      }
      const pub = mapCruParaPublicacao(linha.raw);
      // Publicação cancelada não diz nada sobre o processo (a consolidação
      // também ignora; filtrar aqui tira ela dos peritos do lote).
      if (pub.cancelamento || linha.raw.data_cancelamento) continue;
      const lista = porProcesso.get(linha.numero_processo) ?? [];
      lista.push(pub);
      porProcesso.set(linha.numero_processo, lista);
    }
  }

  // Sem o JSON original não dá pra rodar as regras novas naquela publicação,
  // e recalcular sem ela é o mesmo problema da leitura parcial.
  if (semRaw > 0) {
    return {
      ok: false,
      error: `${semRaw} publicação(ões) sem o JSON original (raw) — não dá pra recalcular com segurança.`,
    };
  }

  // Peritos do lote INTEIRO antes de consolidar qualquer processo: o
  // calculista é polo A em vários processos, mas só alguns textos dizem
  // "perito". No batch isso dependia da ordem; aqui não.
  const peritos = new Set<string>();
  for (const pubs of porProcesso.values()) {
    for (const nome of peritosCitados(pubs)) peritos.add(nome);
  }

  // A leitura veio por id; a consolidação junta as red flags na ordem de
  // entrada, então reordena como a API entrega pro batch.
  for (const pubs of porProcesso.values()) pubs.sort(porRecencia);

  const consolidados = new Map<string, ProcessoConsolidado>();
  for (const [processo, pubs] of porProcesso) {
    consolidados.set(processo, {
      ...consolidarProcesso(pubs, { peritos }),
      advogadosCitados: [...new Set(pubs.flatMap((p) => p.advogados.map((a) => a.nome)))],
    });
  }

  const diffs = calcularDiffs(linhas, consolidados, { peritos });
  return {
    ok: true,
    diffs,
    hash: hashDiff(diffs),
    resumo: resumirDiffs(diffs),
    atualizacoes: montarAtualizacoes(linhas, consolidados, diffs),
  };
}

/**
 * Recalcula credor, advogado e red flags da fila a partir das publicações do
 * DJEN já guardadas (sem chamar a API) — ver `lib/prospeccao/reconsolidar.ts`.
 *
 * Duas fases, sempre nesta ordem:
 *   1. `aplicar: false` — simula e devolve o diff + um hash dele. Não grava.
 *   2. `aplicar: true` com o hash da simulação — recalcula do zero, recusa se
 *      o diff mudou e grava só os itens 'corrigir', um update por linha,
 *      condicionado ao status lido. 'revisar' nunca é gravado.
 *
 * Só admin: reescreve credor de dezenas de linhas de uma vez. Não mexe em
 * status, judit_status nem judit_enriquecido_em — a linha continua
 * "enriquecida em" quando o DJEN foi consultado de fato.
 */
export async function reconsolidarProspeccaoDjen(input: {
  aplicar: boolean;
  hashEsperado?: string;
}): Promise<ResultadoReconsolidacao> {
  const auth = await exigirPerfil(['admin']);
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = await createClient();
  const calculo = await calcular(supabase);
  if (!calculo.ok) return calculo;
  const { diffs, hash, resumo, atualizacoes } = calculo;

  if (!input?.aplicar) return { ok: true, aplicado: false, diffs, hash, resumo };

  if (!input.hashEsperado || input.hashEsperado !== hash) return { ok: false, error: ERRO_HASH };

  let atualizadas = 0;
  const falhas: string[] = [];
  for (let i = 0; i < atualizacoes.length; i += UPDATES_EM_PARALELO) {
    const lote = atualizacoes.slice(i, i + UPDATES_EM_PARALELO);
    const resultados = await Promise.all(
      lote.map((a) =>
        supabase
          .from('prospeccao_precatorios')
          .update(a.colunas)
          .eq('id', a.id)
          // Se a linha virou lead ou foi descartada entre a leitura e aqui,
          // o update não casa nada e ela fica como está.
          .eq('status', a.statusLido)
          // O select devolve só as linhas que o banco gravou de fato (RLS ou
          // status trocado zeram o retorno sem dar erro).
          .select('id'),
      ),
    );
    resultados.forEach(({ data, error }, j) => {
      if (error) falhas.push(`${lote[j]!.numero_processo}: ${error.message}`);
      else atualizadas += data?.length ?? 0;
    });
  }

  revalidatePath('/admin/prospeccao');
  return {
    ok: true,
    aplicado: true,
    atualizadas,
    esperadas: atualizacoes.length,
    falhas,
    resumo,
  };
}
