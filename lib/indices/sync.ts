/**
 * Sincronização das séries de índices pro banco.
 *
 * Regra central: **só persistimos meses FECHADOS**. A série 4390 (Selic) devolve
 * o mês corrente ainda acumulando — em 09/09/2026 ela retornava set/2026 = 0,26
 * (só os dias decorridos) contra ago/2026 = 1,09 (mês inteiro). Gravar o mês
 * corrente faria a correção sair a menor, e o erro ficaria congelado no snapshot.
 *
 * Segunda regra, aprendida depois: **nunca mandamos `numero_indice: null`**. O
 * PostgREST monta o `DO UPDATE SET` a partir da união das chaves de todas as
 * linhas do lote, então a chave presente com null gera
 * `numero_indice = EXCLUDED.numero_indice` e APAGA o valor que já estava no
 * banco. Uma falha transitória do IBGE zerava as 561 linhas de IPCA de uma vez,
 * em silêncio, porque o catch era vazio.
 *
 * O prejuízo no fator é pequeno — medido: ~0,0003% em 200 meses, com o sinal
 * alternando. O que quebra é o invariante que a migration 021 declara por
 * escrito ("o valor usado num cálculo não pode mudar depois"): uma linha com
 * `coletado_em` de hoje e `numero_indice` vindo de outra coleta faz a tabela de
 * auditoria mentir. Daí os dois upserts separados abaixo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buscarSerie } from './bcb';
import { buscarNumeroIndiceIpca } from './ibge';
import { planejarJanela, type Janela, type ResumoSerieBanco } from './janela';
import { DEF_SERIES, IBGE_IPCA, SERIES, type Serie } from './series';

export type ResultadoSync = {
  serie: Serie;
  gravados: number;
  ultimaCompetencia: string | null;
  erro?: string;
  /**
   * O IPCA foi gravado, mas sem o número-índice do IBGE.
   *
   * Não é erro: a variação mensal entrou e o cálculo continua funcionando pelo
   * encadeamento. É aviso porque o motivo precisa chegar a algum lugar — o
   * `catch` vazio que existia aqui antes é o que tornava o bug invisível.
   */
  avisoNumeroIndice?: string;
};

/** Primeiro dia do mês corrente, ISO. Competências >= isso ainda não fecharam. */
function primeiroDiaMesCorrente(hoje = new Date()): string {
  const ano = hoje.getUTCFullYear();
  const mes = String(hoje.getUTCMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}-01`;
}

/**
 * Esperas entre tentativas, em ms. Três tentativas no total.
 *
 * O SGS falha de forma transitória — HTML no lugar de JSON, 502, conexão
 * travada — e foi observado por quatro medições independentes em taxas que vão
 * de 0% a 11%. Ninguém tem a taxa-base, então o retry não está dimensionado
 * por ela: está aqui porque o modo de falha é real, é transiente (a mesma URL
 * voltou em ~300 ms na tentativa seguinte) e **a Vercel não retenta cron**. Uma
 * execução perdida sem retry custa um dia inteiro de atraso.
 */
const ESPERAS_PADRAO = [0, 2_000, 5_000] as const;

const dormir = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * Sincroniza uma série. Busca do início configurado (ou de `desdeIso`) até hoje,
 * descarta o mês em curso e grava o resto.
 *
 * Upsert por (serie, competencia): reexecutar é seguro. Valores revisados pela
 * fonte são atualizados, e `coletado_em` registra quando.
 */
export async function sincronizarSerie(
  supabase: SupabaseClient,
  serie: Serie,
  desdeIso?: string,
  hoje = new Date(),
  esperasMs: readonly number[] = ESPERAS_PADRAO,
): Promise<ResultadoSync> {
  const def = DEF_SERIES[serie];
  const inicio = desdeIso ?? def.inicio;
  const fim = hoje.toISOString().slice(0, 10);
  const corteMesAberto = primeiroDiaMesCorrente(hoje);

  try {
    const pontos = await buscarComRetry(serie, inicio, fim, esperasMs);

    // Descarta o mês que ainda não fechou
    const fechados = pontos.filter((p) => p.competencia < corteMesAberto);
    if (fechados.length === 0) {
      return { serie, gravados: 0, ultimaCompetencia: null };
    }

    // Pro IPCA, enriquecemos com o número-índice do IBGE (fator = I_f / I_i)
    let numerosIndice = new Map<string, number>();
    let avisoNumeroIndice: string | undefined;
    if (serie === 'ipca') {
      try {
        const pontosIbge = await buscarNumeroIndiceIpca(fechados[0]!.competencia, fim);
        numerosIndice = new Map(pontosIbge.map((p) => [p.competencia, p.numeroIndice]));
      } catch (err) {
        // Número-índice é otimização, não requisito: sem ele o fator ainda sai
        // encadeando as variações. Mas o motivo sobe — antes isso era engolido,
        // e era o que fazia o bug do null passar sem ninguém ver.
        avisoNumeroIndice = err instanceof Error ? err.message : String(err);
      }
    }

    // ── Dois lotes, divididos por LINHA e não por coluna ───────────────────
    //
    // O PostgREST monta o `columns=` de cada requisição com a UNIÃO das chaves
    // das linhas daquele lote, e esse conjunto vira tanto o INSERT quanto o
    // `DO UPDATE SET`. Então a chave `numero_indice` presente com null gera
    // `numero_indice = EXCLUDED.numero_indice` e APAGA o que estava gravado —
    // o bug original.
    //
    // A primeira tentativa de conserto foi mandar um segundo lote só com
    // {serie, competencia, numero_indice}, apostando que a linha já existia e
    // cairia no UPDATE. **Não funciona**, e foi preciso rodar pra descobrir:
    //
    //   null value in column "variacao_pct" violates not-null constraint
    //
    // Num `INSERT ... ON CONFLICT DO UPDATE` o Postgres monta e valida a tupla
    // candidata ANTES de resolver o conflito, então as colunas NOT NULL que
    // faltam barram a operação mesmo quando a linha já existe.
    //
    // A divisão certa é por linha: cada lote carrega linhas COMPLETAS, e o que
    // muda entre eles é se a coluna `numero_indice` existe naquele conjunto.
    const base = (p: { competencia: string; valor: number }) => ({
      serie,
      competencia: p.competencia,
      variacao_pct: p.valor,
      fonte: numerosIndice.has(p.competencia) ? `${def.fonte}+${IBGE_IPCA.fonte}` : def.fonte,
      coletado_em: hoje.toISOString(),
    });

    const semIndice = fechados.filter((p) => !numerosIndice.has(p.competencia)).map(base);
    const comIndice = fechados
      .filter((p) => numerosIndice.has(p.competencia))
      .map((p) => ({ ...base(p), numero_indice: numerosIndice.get(p.competencia)! }));

    // Linhas sem número-índice: a coluna nem aparece, então o valor que já
    // está no banco fica intacto.
    if (semIndice.length > 0) {
      const { error } = await supabase
        .from('indices_economicos')
        .upsert(semIndice, { onConflict: 'serie,competencia' });
      if (error) return { serie, gravados: 0, ultimaCompetencia: null, erro: error.message };
    }

    // Linhas com número-índice: lote completo, inclusive a coluna.
    if (comIndice.length > 0) {
      const { error } = await supabase
        .from('indices_economicos')
        .upsert(comIndice, { onConflict: 'serie,competencia' });
      if (error) return { serie, gravados: 0, ultimaCompetencia: null, erro: error.message };
    }

    return {
      serie,
      gravados: fechados.length,
      ultimaCompetencia: fechados[fechados.length - 1]!.competencia,
      ...(avisoNumeroIndice ? { avisoNumeroIndice } : {}),
    };
  } catch (err) {
    return {
      serie,
      gravados: 0,
      ultimaCompetencia: null,
      erro: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Busca com retry. Não classifica o erro de propósito.
 *
 * Todos os modos de falha observados no SGS são transientes: HTML no lugar de
 * JSON, 502, conexão travada. Tentar distinguir "vale retentar" de "não vale"
 * exigiria confiar numa taxonomia que ninguém mediu — e o custo de retentar um
 * erro permanente é 7 segundos, contra um dia de atraso se o transiente passar.
 *
 * Pior caso com as esperas padrão: 6 séries × 3 tentativas × 10 s de timeout
 * de rede + 20 s do IBGE ≈ 200 s. Cabe nos 300 s de maxDuration do Hobby, e a
 * execução típica (janela incremental) fica em ~1-5 s.
 */
async function buscarComRetry(
  serie: Serie,
  inicio: string,
  fim: string,
  esperasMs: readonly number[],
) {
  let ultimoErro: unknown;
  for (const espera of esperasMs) {
    await dormir(espera);
    try {
      return await buscarSerie(serie, inicio, fim);
    } catch (err) {
      ultimoErro = err;
    }
  }
  throw ultimoErro;
}

export type OpcoesSync = {
  /**
   * `completa` pede cada série desde o início do catálogo. É o que o botão do
   * admin faz, e o que o sync mensal faz pra capturar revisão de valor antigo.
   *
   * `incremental` deriva a janela do que já está no banco. É o modo do cron
   * diário: 150–196 bytes por série contra 95 KB, e ~18 linhas de upsert
   * contra 2.529.
   */
  tipo: 'completa' | 'incremental';
  sobreposicaoMeses?: number;
  hoje?: Date;
  /** Esperas entre tentativas. Injetado pelos testes pra não dormir de verdade. */
  esperasMs?: readonly number[];
};

/**
 * Sincroniza todas as séries. Sequencial de propósito: são 6 chamadas a uma API
 * pública sem SLA — não vale a pena martelar em paralelo pra economizar segundos
 * num job que roda 1x por dia.
 *
 * O default é `completa` pra que o caminho da UI continue idêntico: quem clica
 * "Sincronizar" espera uma carga cheia, não uma otimização silenciosa.
 */
export async function sincronizarTodas(
  supabase: SupabaseClient,
  opcoes: OpcoesSync = { tipo: 'completa' },
): Promise<ResultadoSync[]> {
  const hoje = opcoes.hoje ?? new Date();

  // No modo incremental a janela vem do BANCO, nunca do relógio — uma janela
  // ancorada em `hoje` não cicatriza buraco deixado por um cron parado semanas.
  let janelas = new Map<Serie, Janela>();
  if (opcoes.tipo === 'incremental') {
    const resumos = await lerResumoDoBanco(supabase);
    janelas = new Map(
      SERIES.map((s) => [s, planejarJanela(s, resumos.get(s), opcoes.sobreposicaoMeses)]),
    );
  }

  const resultados: ResultadoSync[] = [];
  for (const serie of SERIES) {
    const janela = janelas.get(serie);
    resultados.push(
      await sincronizarSerie(supabase, serie, janela?.desdeIso, hoje, opcoes.esperasMs),
    );
  }
  return resultados;
}

/**
 * Estado atual de cada série, pela RPC que o painel já usa.
 *
 * LANÇA quando a RPC falha, de propósito. Cair pro modo completo em silêncio
 * seria pior: ninguém perceberia, e o job voltaria a reescrever 2.529 linhas
 * por dia — exatamente o que a janela existe pra evitar. Falhar alto deixa o
 * motivo no log da execução.
 */
async function lerResumoDoBanco(supabase: SupabaseClient): Promise<Map<Serie, ResumoSerieBanco>> {
  type Linha = {
    serie: Serie;
    total: number;
    primeira_competencia: string | null;
    ultima_competencia: string | null;
  };

  const { data, error } = await supabase.rpc('resumo_indices_economicos');
  if (error) {
    throw new Error(`Não consegui ler o resumo das séries pra planejar a janela: ${error.message}`);
  }

  const linhas = (data ?? []) as unknown as Linha[];
  return new Map(
    linhas.map((l) => [
      l.serie,
      {
        total: Number(l.total),
        primeiraCompetencia: l.primeira_competencia,
        ultimaCompetencia: l.ultima_competencia,
      },
    ]),
  );
}
