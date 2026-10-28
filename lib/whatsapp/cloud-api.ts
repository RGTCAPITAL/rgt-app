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

export type ResultadoEnvioModelo =
  { ok: true; waMessageId: string; waId: string | null } | { ok: false; erro: string };

/**
 * Erros da Meta que o broker consegue entender e resolver. O resto vai pro
 * log com o código, e a tela diz só que falhou.
 */
const ERRO_MODELO: Record<number, string> = {
  132001: 'O modelo ainda não existe ou não foi aprovado pela Meta.',
  132015: 'A Meta pausou este modelo por qualidade. Veja o aviso no sino.',
  132016: 'A Meta desligou este modelo.',
  131026: 'Esse número não tem WhatsApp, ou não pode receber mensagem.',
  131030: 'O número de teste da Meta só envia pra números cadastrados na lista dela.',
  131049: 'A Meta segurou o envio pra não saturar quem recebe. Tente mais tarde.',
  130472: 'A Meta segurou o envio: esse número faz parte de um teste dela.',
};

/**
 * Envia um modelo aprovado — o único jeito de a RGT escrever primeiro. Devolve
 * o `wa_id` que a Meta usou: é ele, e não o telefone da planilha, que o
 * webhook vai informar quando a pessoa responder (às vezes sem o nono dígito).
 */
export async function enviarModelo(
  telefone: string,
  modelo: { nome: string; idioma: string },
  variaveis: readonly string[],
): Promise<ResultadoEnvioModelo> {
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
        type: 'template',
        template: {
          name: modelo.nome,
          language: { code: modelo.idioma },
          ...(variaveis.length
            ? {
                components: [
                  {
                    type: 'body',
                    parameters: variaveis.map((text) => ({ type: 'text', text })),
                  },
                ],
              }
            : {}),
        },
      }),
    });
  } catch {
    return { ok: false, erro: 'Não foi possível falar com o WhatsApp. Tente de novo.' };
  }

  const corpo = (await resp.json().catch(() => null)) as {
    messages?: { id?: string }[];
    contacts?: { wa_id?: string }[];
    error?: { message?: string; code?: number };
  } | null;

  const id = corpo?.messages?.[0]?.id;
  if (!resp.ok || !id) {
    const codigo = corpo?.error?.code;
    console.error('[whatsapp] modelo recusado', resp.status, codigo, corpo?.error?.message);
    return {
      ok: false,
      erro:
        (codigo && ERRO_MODELO[codigo]) ||
        'O WhatsApp recusou a mensagem. Ela ficou registrada como falha.',
    };
  }

  return {
    ok: true,
    waMessageId: id,
    waId: corpo?.contacts?.[0]?.wa_id?.replace(/\D/g, '') ?? null,
  };
}
