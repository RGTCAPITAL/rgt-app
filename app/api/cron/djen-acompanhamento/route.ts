import { NextResponse } from 'next/server';
import { autorizarCron } from '@/lib/cron/autorizar';
import { acompanharProcessos } from '@/lib/djen/acompanhamento';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET/POST /api/cron/djen-acompanhamento
 *
 * Rotina diária do "processo andou" (ver lib/djen/acompanhamento.ts). Roda de
 * manhã, uma vez por dia — o limite do plano Hobby da Vercel, e suficiente: o
 * DJEN publica em lote diário.
 *
 * Mesmo portão da rotina de índices: CRON_SECRET, rota pública no proxy por
 * `/api/cron`. Sem o segredo, a URL conhecida viraria um jeito de qualquer um
 * gastar a cota de 20 consultas/minuto da RGT no CNJ.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function rodar(req: Request): Promise<NextResponse> {
  const auth = autorizarCron(req);
  if (!auth.ok) return NextResponse.json({ erro: auth.erro }, { status: auth.status });

  try {
    const r = await acompanharProcessos(createServiceClient());
    return NextResponse.json(r, { status: r.falhas && !r.verificados ? 500 : 200 });
  } catch (err) {
    // O motivo vai pro log da Vercel, não pro corpo: a rota é pública.
    console.error('[cron/djen-acompanhamento] abortou:', err);
    return NextResponse.json({ erro: 'falha_no_acompanhamento' }, { status: 500 });
  }
}

export const GET = rodar;
export const POST = rodar;
