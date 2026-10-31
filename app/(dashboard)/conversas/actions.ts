'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { exigirPerfil } from '@/lib/auth/roles';
import { estadoJanela, LIMITE_TEXTO_WHATSAPP } from '@/lib/whatsapp/conversas';
import { enviarTexto, whatsappConectado } from '@/lib/whatsapp/cloud-api';
import { repassarTarefasDeRegra } from '@/lib/tarefas/repassar';

type Resultado = { ok: true } | { ok: false; error: string };

/**
 * Admin ou gestão dão dono ao lead da conversa. É o dono que faz a conversa
 * aparecer pro broker (RLS de /conversas passa por leads.dono_id), e ele é
 * avisado na hora pelo sino.
 */
export async function atribuirDono(leadId: string, donoId: string): Promise<Resultado> {
  const auth = await exigirPerfil(['admin', 'gestao']);
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = await createClient();
  // O dono de antes decide se as tarefas de regra precisam mudar de mão.
  const { data: antes } = await supabase
    .from('leads')
    .select('dono_id')
    .eq('id', leadId)
    .maybeSingle<{ dono_id: string | null }>();
  const { data, error } = await supabase
    .from('leads')
    .update({ dono_id: donoId })
    .eq('id', leadId)
    .select('id, nome')
    .single<{ id: string; nome: string }>();
  if (error || !data) return { ok: false, error: 'Não foi possível atribuir.' };

  // Só admin e gestão chegam aqui, e a RLS de tarefas deixa os dois mudarem
  // qualquer tarefa: o mesmo cliente basta.
  if (antes && antes.dono_id !== donoId) {
    await repassarTarefasDeRegra(supabase, leadId, donoId);
  }

  // Aviso pelo sino. Service role porque notificação não tem policy de
  // INSERT pra usuário — quem cria aviso é sempre o sistema.
  if (donoId !== auth.userId) {
    const { data: conversa } = await supabase
      .from('whatsapp_conversas')
      .select('id')
      .eq('lead_id', leadId)
      .maybeSingle<{ id: string }>();
    await createServiceClient()
      .from('notificacoes')
      .insert({
        destinatario: donoId,
        tipo: 'whatsapp',
        titulo: `Conversa atribuída a você: ${data.nome}`,
        descricao: 'Abra pra ver o que a pessoa já contou ao robô antes de responder.',
        link: conversa ? `/conversas?c=${conversa.id}` : '/crm',
      });
  }

  revalidatePath('/conversas');
  revalidatePath('/crm');
  revalidatePath('/tarefas');
  return { ok: true };
}

/**
 * Broker tira o robô da conversa. Não volta sozinho: a pesquisa de 2026-09-23
 * é explícita que o robô não retoma uma conversa que um humano assumiu.
 */
export async function assumirConversa(conversaId: string): Promise<Resultado> {
  const auth = await exigirPerfil(['admin', 'gestao', 'broker']);
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = await createClient();
  // RLS limita ao broker dono do lead. `.select` pra saber se alguma linha
  // mudou: UPDATE barrado por RLS não dá erro, só não afeta nada.
  const { data, error } = await supabase
    .from('whatsapp_conversas')
    .update({
      bot_pausado: true,
      pausado_motivo: 'Broker assumiu a conversa',
      pausado_em: new Date().toISOString(),
      status: 'aguardando_humano',
    })
    .eq('id', conversaId)
    .eq('bot_pausado', false)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data?.length)
    return { ok: false, error: 'Conversa não encontrada ou já está com um humano.' };

  revalidatePath('/conversas');
  return { ok: true };
}

/**
 * Resposta do broker. A ordem dos passos é a regra:
 *
 * 1. Todas as recusas antes de gravar qualquer coisa — opt-out, janela de 24h
 *    e número conectado. Nada que não vai sair entra no registro.
 * 2. Grava a mensagem ANTES de mandar pra Meta, com status "enviando". Se o
 *    envio falhar, o registro fica como falha, mas fica.
 * 3. Atualiza o status com o resultado da Meta.
 */
export async function responderConversa(conversaId: string, texto: string): Promise<Resultado> {
  const auth = await exigirPerfil(['admin', 'gestao', 'broker']);
  if (!auth.ok) return { ok: false, error: auth.error };

  const conteudo = texto.trim();
  if (!conteudo) return { ok: false, error: 'Escreva a mensagem.' };
  if (conteudo.length > LIMITE_TEXTO_WHATSAPP) {
    return { ok: false, error: `Mensagem acima de ${LIMITE_TEXTO_WHATSAPP} caracteres.` };
  }

  const supabase = await createClient();
  const { data: conversa } = await supabase
    .from('whatsapp_conversas')
    .select('id, telefone, janela_expira_em, bot_pausado')
    .eq('id', conversaId)
    .maybeSingle<{
      id: string;
      telefone: string;
      janela_expira_em: string | null;
      bot_pausado: boolean;
    }>();
  if (!conversa) return { ok: false, error: 'Conversa não encontrada.' };

  const { data: saiu } = await supabase
    .from('whatsapp_optout')
    .select('id')
    .eq('telefone', conversa.telefone)
    .maybeSingle();
  if (saiu) return { ok: false, error: 'Esta pessoa pediu pra não receber mais mensagens.' };

  if (!estadoJanela(conversa.janela_expira_em).aberta) {
    return {
      ok: false,
      error: 'A janela de 24h está fechada. Só dá pra mandar um modelo aprovado pela Meta.',
    };
  }

  if (!whatsappConectado()) {
    return {
      ok: false,
      error: 'O número da RGT ainda não está conectado ao WhatsApp. Nada foi enviado.',
    };
  }

  const { data: msg, error: erroGravar } = await supabase
    .from('whatsapp_mensagens')
    .insert({
      conversa_id: conversa.id,
      direcao: 'saida',
      autor: 'humano',
      autor_id: auth.userId,
      tipo: 'texto',
      conteudo,
      status_entrega: 'enviando',
    })
    .select('id')
    .single<{ id: string }>();
  if (erroGravar || !msg) {
    return { ok: false, error: 'Não foi possível registrar a mensagem. Nada foi enviado.' };
  }

  // Humano escreveu: o robô sai, se ainda estava conduzindo.
  if (!conversa.bot_pausado) {
    await supabase
      .from('whatsapp_conversas')
      .update({
        bot_pausado: true,
        pausado_motivo: 'Broker respondeu',
        pausado_em: new Date().toISOString(),
        status: 'aguardando_humano',
      })
      .eq('id', conversa.id);
  }

  const envio = await enviarTexto(conversa.telefone, conteudo);

  // Service role porque broker não tem UPDATE em mensagens, de propósito. O
  // trigger da 044 garante que só o status e o id da Meta mudam.
  await createServiceClient()
    .from('whatsapp_mensagens')
    .update(
      envio.ok
        ? { wa_message_id: envio.waMessageId, status_entrega: 'enviada' }
        : { status_entrega: 'falhou' },
    )
    .eq('id', msg.id);

  revalidatePath('/conversas');
  return envio.ok ? { ok: true } : { ok: false, error: envio.erro };
}
