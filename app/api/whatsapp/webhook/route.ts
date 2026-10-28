import { after, NextResponse, type NextRequest } from 'next/server';
import { assinaturaValida, lerWebhook } from '@/lib/whatsapp/webhook-meta';
import { processarMensagemRecebida, processarStatus } from '@/lib/whatsapp/executor';

/**
 * Webhook do WhatsApp Cloud API. Rota pública (está em PUBLIC_ROUTES do
 * proxy): quem autentica é a assinatura da Meta, não sessão.
 *
 * Responde 200 na hora e processa depois, com `after`: o Claude leva alguns
 * segundos, e a Meta reenvia o pacote quando a resposta demora. O reenvio cai
 * no `wa_message_id` UNIQUE e é descartado — mas sem `after` toda mensagem
 * seria processada duas vezes até o banco barrar.
 *
 * Ambiente:
 *   WHATSAPP_VERIFY_TOKEN  — combinado no painel da Meta, só pro aperto de mão
 *   WHATSAPP_APP_SECRET    — segredo do app, assina cada pacote
 */

export const maxDuration = 60;

/** Aperto de mão: a Meta confere que a URL é nossa antes de começar a mandar. */
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === token) {
    return new NextResponse(p.get('hub.challenge') ?? '', { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(req: NextRequest) {
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo) return new NextResponse('WhatsApp não configurado', { status: 503 });

  const corpo = await req.text();
  if (!assinaturaValida(corpo, req.headers.get('x-hub-signature-256'), segredo)) {
    return new NextResponse('Assinatura inválida', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(corpo);
  } catch {
    return new NextResponse('JSON inválido', { status: 400 });
  }

  const { mensagens, status } = lerWebhook(payload);

  after(async () => {
    for (const s of status) {
      await processarStatus(s).catch((e) => console.error('[whatsapp] status', e));
    }
    // Em sequência: duas mensagens da mesma pessoa no mesmo pacote não podem
    // gerar duas respostas paralelas do robô.
    for (const m of mensagens) {
      await processarMensagemRecebida(m).catch((e) =>
        console.error('[whatsapp] mensagem', m.waMessageId, e),
      );
    }
  });

  return NextResponse.json({ ok: true });
}
