import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * POST /api/leads/webhook
 *
 * Recebe leads do rgt-site (form de credores). Autenticado por header x-rgt-secret.
 * Cria lead com origem='site', status='novo', sem dono (admin/gestao distribuem depois).
 * Notifica admin + gestao (perfis comerciais internos).
 *
 * Env vars necessárias:
 *   - LEADS_WEBHOOK_SECRET   (segredo compartilhado com o site)
 *   - SUPABASE_SERVICE_ROLE_KEY  (bypass RLS pra insert público)
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const somenteDigitos = (s: string) => s.replace(/\D/g, '');

/** Exportado pro teste: é aqui que mora a normalização, não no handler. */
export const payloadSchema = z.object({
  nome: z.string().trim().min(2, 'Nome muito curto').max(200),
  telefone: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? somenteDigitos(v) : ''))
    .refine((v) => !v || (v.length >= 10 && v.length <= 13), 'Telefone inválido'),
  email: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Email inválido'),
  cpf_cnpj: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? somenteDigitos(v) : ''))
    .refine((v) => !v || v.length === 11 || v.length === 14, 'CPF ou CNPJ inválido'),
  /**
   * O que o credor digita no campo "número do processo ou ofício
   * requisitório". Não dá pra exigir CNJ: muita gente tem em mãos o número
   * do ofício, que tem formato de tribunal, não do CNJ.
   *
   * Quando vier um CNJ de verdade, guardamos só os 20 dígitos — é assim que
   * a prospecção grava, e é o que permite descobrir que esse credor já está
   * na nossa fila. Qualquer outra coisa fica como a pessoa escreveu.
   */
  numero_processo: z
    .string()
    .trim()
    .max(60)
    .optional()
    .or(z.literal(''))
    .transform((v) => {
      if (!v) return '';
      const d = somenteDigitos(v);
      return d.length === 20 ? d : v;
    }),
  mensagem: z.string().trim().max(2000).optional().or(z.literal('')),
  /**
   * O texto da caixa de autorização que a pessoa marcou, como estava na tela.
   * O site só envia quando a caixa está marcada. Vira a prova do aceite no
   * lead (migration 050); vazio = sem registro, nunca "autorizou".
   */
  consentimento_texto: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .or(z.literal(''))
    .transform((v) => v || ''),
});

/**
 * O banco só aceita CNJ de 20 dígitos em `leads.numero_processo` (033). Número
 * de ofício ou qualquer outra coisa vai pras notas, como a pessoa escreveu.
 * Antes ia direto pro campo: o insert falhava e o lead do site se perdia
 * (o credor via o WhatsApp abrir e nem sabia).
 */
export function notasDoSite(data: { numero_processo: string; mensagem?: string }): {
  numeroProcesso: string | null;
  notas: string | null;
} {
  const cnj = /^\d{20}$/.test(data.numero_processo) ? data.numero_processo : null;
  const partes = [
    !cnj && data.numero_processo ? `Processo ou ofício informado: ${data.numero_processo}` : null,
    data.mensagem ? `Mensagem do site:\n${data.mensagem}` : null,
  ].filter(Boolean);
  return { numeroProcesso: cnj, notas: partes.length ? partes.join('\n\n') : null };
}

export async function POST(req: Request) {
  // 1. Auth via header secret
  const secretHeader = req.headers.get('x-rgt-secret');
  const secretEnv = process.env.LEADS_WEBHOOK_SECRET;
  if (!secretEnv) {
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 });
  }
  if (secretHeader !== secretEnv) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2. Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'body_invalid_json' }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_failed', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // 3. Insere lead com service role (bypass RLS)
  const supabase = createServiceClient();

  const { numeroProcesso, notas: notasFinal } = notasDoSite(data);

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      nome: data.nome,
      telefone: data.telefone || null,
      email: data.email || null,
      cpf_cnpj: data.cpf_cnpj || null,
      numero_processo: numeroProcesso,
      origem: 'site',
      status: 'novo',
      notas: notasFinal,
      // A hora é a do nosso servidor, não a do celular da pessoa.
      ...(data.consentimento_texto
        ? {
            consentimento_em: new Date().toISOString(),
            consentimento_texto: data.consentimento_texto,
          }
        : {}),
    })
    .select('id')
    .single();

  if (error || !lead) {
    console.error('[leads/webhook] insert failed:', error);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }

  // 4. Notifica todos admin+gestao ativos (comerciais internos)
  const { data: perfisAlvo } = await supabase
    .from('perfis')
    .select('id')
    .in('slug', ['admin', 'gestao']);

  const perfilIds = (perfisAlvo ?? []).map((p) => p.id);

  if (perfilIds.length > 0) {
    const { data: destinatarios } = await supabase
      .from('usuarios')
      .select('id')
      .eq('ativo', true)
      .in('perfil_id', perfilIds);

    if (destinatarios && destinatarios.length > 0) {
      // A notificação é o que o comercial lê antes de abrir o CRM, então ela
      // precisa dizer se dá pra ligar agora. A versão anterior escrevia
      // "Sem contato preenchido" sempre que faltava telefone, mesmo havendo
      // e-mail — e o formulário do site nem pedia telefone.
      const contato = [data.telefone ? `Tel ${data.telefone}` : null, data.email || null].filter(
        Boolean,
      );
      const descricao = [
        contato.length > 0 ? contato.join(' · ') : 'Sem telefone nem e-mail',
        data.numero_processo ? `Processo ${data.numero_processo}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      const notifs = destinatarios.map((d: { id: string }) => ({
        destinatario: d.id,
        tipo: 'comentario_novo',
        titulo: `Novo lead do site: ${data.nome}`,
        descricao,
        link: `/crm`,
      }));
      const { error: notifErr } = await supabase.from('notificacoes').insert(notifs);
      if (notifErr) console.error('[leads/webhook] notif insert failed:', notifErr);
    }
  }

  return NextResponse.json({ ok: true, id: lead.id }, { status: 201 });
}

// OPTIONS: negar por default (só o site backend do rgt-site chama, server-side)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'POST',
    },
  });
}
