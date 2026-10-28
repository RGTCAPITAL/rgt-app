import { NextResponse } from 'next/server';
import { autorizarCron as autorizar } from '@/lib/cron/autorizar';
import { createServiceClient } from '@/lib/supabase/service';
import { sincronizarTodas, type ResultadoSync } from '@/lib/indices/sync';

/**
 * GET/POST /api/cron/indices
 *
 * Sincronização agendada das séries de índices. Sem isto, as séries param onde
 * a última pessoa clicou o botão — e a tela de precificação **recusa precificar**
 * quando a série atrasa mais de 2 meses (LIMITE_ATRASO_MESES em
 * lib/precificacao/correcao.ts). Paradas em set/2026, travariam em dezembro.
 *
 * POR QUE UM ROUTE HANDLER E NÃO A SERVER ACTION QUE JÁ EXISTE: a action
 * `sincronizarIndices` tem `exigirPerfil(['admin','gestao'])`, e o agendador não
 * tem sessão — tomaria 403. A porta é separada de propósito; o gate da UI fica
 * onde está.
 *
 * ARMADILHA QUE CUSTARIA O TRABALHO INTEIRO: `/api/cron` tem que estar em
 * PUBLIC_ROUTES do proxy.ts. Sem isso o proxy devolve 307 pra /login, e o cron
 * da Vercel **não segue redirect nem registra log de resposta redirecionada** —
 * o job apareceria configurado, rodaria todo dia, devolveria sucesso e nunca
 * executaria nada. Coberto por proxy.test.ts.
 *
 * Env vars:
 *   - CRON_SECRET                 (o nome é funcional: a Vercel só manda o
 *                                  header Authorization se esta var existir)
 *   - SUPABASE_SERVICE_ROLE_KEY   (a escrita é do sistema, não de uma pessoa)
 */

export const dynamic = 'force-dynamic';
// `runtime` fica de fora: 'nodejs' já é o default e a doc do Next 16.3.3
// instalada pede explicitamente pra remover o export (o valor 'edge' está
// deprecado). Copiar isso do webhook de leads propagaria um vício.

// Teto do Hobby com fluid compute. O pior caso construído é 6 séries × 3
// tentativas × 10 s + 20 s do IBGE ≈ 200 s; a execução típica no modo
// incremental fica em ~1-5 s.
export const maxDuration = 300;

/** Sincroniza tudo desde 1980 nos primeiros dias do mês, incremental no resto. */
const DIAS_DE_CARGA_COMPLETA = 2;

type ModoSync = 'completa' | 'incremental';

function escolherModo(url: string, hoje: Date): ModoSync {
  const pedido = new URL(url).searchParams.get('modo');
  if (pedido === 'completo' || pedido === 'completa') return 'completa';
  if (pedido === 'incremental') return 'incremental';

  // Sem parâmetro: carga completa nos primeiros dias do mês, pra capturar
  // revisão de valor antigo que a sobreposição de 3 meses não alcança (custa
  // 95 KB e ~3,4 s medidos). Dois dias em vez de um porque a entrega da Vercel
  // é best-effort — se o dia 1 for perdido, o dia 2 pega. O upsert é
  // idempotente, então rodar completa duas vezes é inócuo.
  //
  // Decidir aqui em vez de numa segunda entrada do vercel.json evita depender
  // de query string no campo `path`, que não está confirmada.
  return hoje.getUTCDate() <= DIAS_DE_CARGA_COMPLETA ? 'completa' : 'incremental';
}

/**
 * O corpo da resposta NUNCA carrega `resultados[].erro`.
 *
 * As mensagens do Supabase trazem nome de tabela, nome de coluna e SQLSTATE
 * ('column indices_economicos.X does not exist', PGRST205) — numa rota pública
 * isso é oráculo de enumeração de schema. O motivo vai pro log da Vercel, onde
 * só quem tem acesso ao projeto lê.
 */
function corpoPublico(resultados: ResultadoSync[], modo: ModoSync) {
  return {
    modo,
    series: resultados.map((r) => ({
      serie: r.serie,
      // `linhasEscritas`, não "pontos novos": no modo incremental são as ~4
      // linhas da janela de sobreposição, quase sempre reescrevendo o mesmo
      // valor. Quem lê "25 gravados" não pode concluir que entrou dado novo.
      linhasEscritas: r.gravados,
      ultimaCompetencia: r.ultimaCompetencia,
      falhou: Boolean(r.erro),
      semNumeroIndice: Boolean(r.avisoNumeroIndice),
    })),
  };
}

async function sincronizar(req: Request): Promise<NextResponse> {
  const auth = autorizar(req);
  if (!auth.ok) {
    return NextResponse.json({ erro: auth.erro }, { status: auth.status });
  }

  const hoje = new Date();
  const modo = escolherModo(req.url, hoje);

  let resultados: ResultadoSync[];
  try {
    resultados = await sincronizarTodas(createServiceClient(), { tipo: modo, hoje });
  } catch (err) {
    // Chega aqui quando a RPC do resumo falha (o planejador de janela lança de
    // propósito, em vez de cair pro modo completo em silêncio) ou quando falta
    // a service key.
    console.error('[cron/indices] abortou antes de sincronizar:', err);
    return NextResponse.json({ erro: 'falha_na_sincronizacao', modo }, { status: 500 });
  }

  const falhas = resultados.filter((r) => r.erro);
  const avisos = resultados.filter((r) => r.avisoNumeroIndice);

  // Log detalhado — vai pro log da Vercel, não pro corpo. É o que alguém vai
  // ler às 3h da manhã pra entender o que aconteceu.
  for (const r of resultados) {
    if (r.erro) console.error(`[cron/indices] ${r.serie} FALHOU: ${r.erro}`);
    else console.log(`[cron/indices] ${r.serie}: ${r.gravados} linhas, até ${r.ultimaCompetencia}`);
  }
  for (const r of avisos) {
    console.warn(`[cron/indices] ${r.serie} sem número-índice: ${r.avisoNumeroIndice}`);
  }

  // 500 só quando NADA entrou. Falha parcial é 200 porque cinco séries
  // atualizadas é sucesso com ressalva, e porque a Vercel não retenta de
  // qualquer forma — o status só serve pra visibilidade humana. Quem avisa que
  // uma série específica está envelhecendo é o selo de frescor do painel, que é
  // por série e não depende desta resposta.
  const status = falhas.length === resultados.length ? 500 : 200;

  return NextResponse.json(
    {
      ok: status === 200,
      ...corpoPublico(resultados, modo),
      falhas: falhas.length,
      parcial: falhas.length > 0 && falhas.length < resultados.length,
    },
    { status },
  );
}

/** A Vercel dispara cron com GET. */
export async function GET(req: Request) {
  return sincronizar(req);
}

/** POST existe pro disparo manual, pra não precisar montar um GET com header. */
export async function POST(req: Request) {
  return sincronizar(req);
}
