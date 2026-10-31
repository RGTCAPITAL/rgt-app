import { NextResponse } from 'next/server';
import { autorizarCron } from '@/lib/cron/autorizar';
import { rodarRegrasDeLead } from '@/lib/regras/executar';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET/POST /api/cron/regras
 *
 * Rodada diária das regras automáticas de lead (follow-up e lead parado, ver
 * lib/regras). Cada regra só CRIA TAREFA para uma pessoa; nada sai pro
 * cliente. A terceira regra, "processo andou", roda dentro do cron do DJEN,
 * que é quem sabe o que é publicação nova.
 *
 * Separada do djen-acompanhamento de propósito (CRON.md): aquela função gasta
 * até ~250 dos 270 s com o DJEN, e um erro de CRM lá dentro ficaria misturado
 * ao do Diário no log. Esta custa ~1 s.
 *
 * Mesmo portão das outras rotinas: CRON_SECRET, rota pública no proxy por
 * `/api/cron`.
 */

// Vale sem cacheComponents (conferido em node_modules/next/dist/docs, Route
// Segment Config): só some quando cacheComponents está ligado.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function rodar(req: Request): Promise<NextResponse> {
  const auth = autorizarCron(req);
  if (!auth.ok) return NextResponse.json({ erro: auth.erro }, { status: auth.status });

  try {
    const r = await rodarRegrasDeLead(createServiceClient());
    // Tudo que tentou falhou: 500, pra a Vercel marcar a execução como erro.
    // Falha parcial é 200 — as tarefas que saíram saíram, e o resto vai pro log.
    return NextResponse.json(r, { status: r.falhas && !r.tarefasCriadas ? 500 : 200 });
  } catch (err) {
    // O motivo vai pro log da Vercel, não pro corpo: a rota é pública.
    console.error('[cron/regras] abortou:', err);
    return NextResponse.json({ erro: 'falha_nas_regras' }, { status: 500 });
  }
}

export const GET = rodar;
export const POST = rodar;
