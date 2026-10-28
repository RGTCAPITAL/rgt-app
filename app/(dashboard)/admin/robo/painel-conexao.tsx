import { headers } from 'next/headers';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { fmtDataHoraBR } from '@/lib/formatters';

/**
 * O que precisa estar de pé pro robô atender, num lugar só. Feito pra o dia de
 * ligar o número (2026-10-29): se a mensagem não chega ou não sai, este painel
 * diz em qual elo parou — chave faltando na Vercel, Meta sem o endereço do
 * webhook, ou Meta recusando o envio.
 *
 * Mostra só SE cada chave existe. Nunca o valor: a página é de admin, mas
 * print de tela vaza (já aconteceu com a service_role em 20/10).
 */
const CHAVES = [
  { nome: 'WHATSAPP_PHONE_NUMBER_ID', pra: 'qual número envia' },
  { nome: 'WHATSAPP_TOKEN', pra: 'autoriza o envio em nome da RGT' },
  { nome: 'WHATSAPP_APP_SECRET', pra: 'confere que a mensagem veio da Meta' },
  { nome: 'WHATSAPP_VERIFY_TOKEN', pra: 'aperto de mão ao cadastrar o webhook' },
  { nome: 'ANTHROPIC_API_KEY', pra: 'a IA que conversa' },
] as const;

function Item({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      ) : (
        <CircleDashed className="mt-0.5 size-4 shrink-0 text-neutral-400" />
      )}
      <span className={ok ? 'text-neutral-900' : 'text-neutral-600'}>{children}</span>
    </li>
  );
}

export async function PainelConexao() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const protocolo = host.startsWith('localhost') ? 'http' : 'https';
  const urlWebhook = `${protocolo}://${host}/api/whatsapp/webhook`;

  const supabase = await createClient();
  const [{ data: recebida }, { data: enviada }] = await Promise.all([
    supabase
      .from('whatsapp_mensagens')
      .select('created_at')
      .eq('direcao', 'entrada')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ created_at: string }>(),
    supabase
      .from('whatsapp_mensagens')
      .select('created_at, status_entrega')
      .eq('direcao', 'saida')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ created_at: string; status_entrega: string | null }>(),
  ]);

  const faltando = CHAVES.filter((c) => !process.env[c.nome]);

  return (
    <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 text-sm font-semibold text-neutral-900">Conexão com o WhatsApp</h2>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-neutral-500 uppercase">
            Chaves neste ambiente
          </p>
          <ul className="space-y-1.5 text-sm">
            {CHAVES.map((c) => (
              <Item key={c.nome} ok={Boolean(process.env[c.nome])}>
                <code className="text-xs">{c.nome}</code>
                <span className="block text-xs text-neutral-500">{c.pra}</span>
              </Item>
            ))}
          </ul>
          {faltando.length > 0 && (
            <p className="mt-2 text-xs text-amber-800">
              Falta{faltando.length > 1 ? 'm' : ''} {faltando.length}. Sem elas o robô não envia
              nada — e não finge que enviou.
            </p>
          )}
        </div>
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-medium tracking-wide text-neutral-500 uppercase">
              Endereço do webhook (colar na Meta)
            </p>
            <code className="block rounded-md bg-neutral-100 px-2 py-1.5 text-xs break-all">
              {urlWebhook}
            </code>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium tracking-wide text-neutral-500 uppercase">
              Tráfego
            </p>
            <ul className="space-y-1.5 text-sm">
              <Item ok={Boolean(recebida)}>
                Última mensagem recebida:{' '}
                {recebida ? fmtDataHoraBR(recebida.created_at) : 'nenhuma ainda'}
              </Item>
              <Item ok={Boolean(enviada) && enviada?.status_entrega !== 'falhou'}>
                Última enviada:{' '}
                {enviada
                  ? `${fmtDataHoraBR(enviada.created_at)} · ${enviada.status_entrega ?? 'sem status'}`
                  : 'nenhuma ainda'}
              </Item>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
