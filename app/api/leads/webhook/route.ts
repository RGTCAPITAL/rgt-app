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

const payloadSchema = z.object({
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
  mensagem: z.string().trim().max(2000).optional().or(z.literal('')),
});

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

  const notasFinal = data.mensagem ? `Mensagem do site:\n${data.mensagem}` : null;

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      nome: data.nome,
      telefone: data.telefone || null,
      email: data.email || null,
      cpf_cnpj: data.cpf_cnpj || null,
      origem: 'site',
      status: 'novo',
      notas: notasFinal,
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
      const notifs = destinatarios.map((d: { id: string }) => ({
        destinatario: d.id,
        tipo: 'comentario_novo',
        titulo: `Novo lead do site: ${data.nome}`,
        descricao: data.telefone
          ? `Telefone: ${data.telefone}${data.email ? ' · ' + data.email : ''}`
          : data.email || 'Sem contato preenchido',
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
