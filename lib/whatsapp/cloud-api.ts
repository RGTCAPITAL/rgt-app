/**
 * Envio pela WhatsApp Cloud API da Meta.
 *
 * Desligado até o número da RGT existir: sem `WHATSAPP_TOKEN` e
 * `WHATSAPP_PHONE_NUMBER_ID` no ambiente, `whatsappConectado()` é falso e a
 * tela avisa o broker em vez de fingir que mandou. Nada aqui grava no banco —
 * quem chama grava antes e atualiza o status depois, pra que a prova exista
 * mesmo quando o envio falha.
 *
 * Só servidor: o token dá acesso de envio em nome da RGT.
 */

/** Conferir a versão vigente no painel da Meta ao conectar o número. */
const VERSAO_GRAPH = process.env.WHATSAPP_GRAPH_VERSION ?? 'v23.0';

export function whatsappConectado(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export type ResultadoEnvio = { ok: true; waMessageId: string } | { ok: false; erro: string };

export async function enviarTexto(telefone: string, texto: string): Promise<ResultadoEnvio> {
  const token = process.env.WHATSAPP_TOKEN;
  const numeroId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !numeroId) {
    return { ok: false, erro: 'O número da RGT ainda não está conectado ao WhatsApp.' };
  }

  let resp: Response;
  try {
    resp = await fetch(`https://graph.facebook.com/${VERSAO_GRAPH}/${numeroId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: telefone,
        type: 'text',
        text: { preview_url: false, body: texto },
      }),
    });
  } catch {
    return { ok: false, erro: 'Não foi possível falar com o WhatsApp. Tente de novo.' };
  }

  const corpo = (await resp.json().catch(() => null)) as {
    messages?: { id?: string }[];
    error?: { message?: string };
  } | null;

  const id = corpo?.messages?.[0]?.id;
  if (!resp.ok || !id) {
    // O texto da Meta vai pro log, não pra tela: pode citar detalhes da conta.
    console.error('[whatsapp] envio recusado', resp.status, corpo?.error?.message);
    return { ok: false, erro: 'O WhatsApp recusou a mensagem. Ela ficou registrada como falha.' };
  }

  return { ok: true, waMessageId: id };
}
