'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };

/**
 * Edição dos textos de primeiro contato.
 *
 * O texto é a voz da empresa falando com o credor e muda toda semana nas
 * primeiras semanas, enquanto se descobre o que converte. Por isso mora no
 * banco e é editável aqui, sem deploy.
 */

const LIMITE_TEXTO = 1200;

async function exigirGestao() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Sessão expirada.' };

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();

  const role = usuario?.perfil?.slug ?? '';
  if (!['admin', 'gestao'].includes(role)) {
    return { ok: false as const, error: 'Apenas admin ou gestão pode editar os modelos.' };
  }
  return { ok: true as const, supabase, userId: user.id };
}

export async function salvarModelo(id: string, nome: string, texto: string): Promise<Result> {
  const auth = await exigirGestao();
  if (!auth.ok) return auth;

  const nomeLimpo = nome.trim();
  const textoLimpo = texto.trim();

  if (nomeLimpo.length < 3) return { ok: false, error: 'Dê um nome ao modelo.' };
  if (textoLimpo.length < 20) {
    return { ok: false, error: 'O texto está curto demais para um primeiro contato.' };
  }
  if (textoLimpo.length > LIMITE_TEXTO) {
    return {
      ok: false,
      error: `O WhatsApp corta mensagem longa no link. Máximo ${LIMITE_TEXTO} caracteres — este tem ${textoLimpo.length}.`,
    };
  }
  // Variável escrita errada vira texto literal na mensagem do cliente.
  const invalidas = [...textoLimpo.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1]!)
    .filter((v) => !['nome', 'nome_completo', 'valor', 'ente', 'processo'].includes(v));
  if (invalidas.length > 0) {
    return {
      ok: false,
      error: `Variável desconhecida: {${invalidas[0]}}. As disponíveis são {nome}, {nome_completo}, {valor}, {ente} e {processo}.`,
    };
  }

  const { error } = await auth.supabase
    .from('modelos_mensagem')
    .update({ nome: nomeLimpo, texto: textoLimpo, atualizado_por: auth.userId })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/mensagens');
  revalidatePath('/crm');
  return { ok: true };
}

export async function alternarAtivo(id: string, ativo: boolean): Promise<Result> {
  const auth = await exigirGestao();
  if (!auth.ok) return auth;

  // Desativar todos deixaria o botão de WhatsApp abrir conversa vazia, sem
  // que ninguém entenda por quê.
  if (!ativo) {
    const { count } = await auth.supabase
      .from('modelos_mensagem')
      .select('id', { count: 'exact', head: true })
      .eq('ativo', true);
    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        error:
          'Pelo menos um modelo precisa ficar ativo, senão o botão do WhatsApp abre sem mensagem.',
      };
    }
  }

  const { error } = await auth.supabase
    .from('modelos_mensagem')
    .update({ ativo, atualizado_por: auth.userId })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/mensagens');
  revalidatePath('/crm');
  return { ok: true };
}
