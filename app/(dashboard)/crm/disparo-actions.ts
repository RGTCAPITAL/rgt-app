'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigirPerfil } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { enviarModelo, whatsappConectado } from '@/lib/whatsapp/cloud-api';
import { estadoJanela } from '@/lib/whatsapp/conversas';
import {
  INTERVALO_MINIMO_DIAS_MODELO,
  MODELOS,
  montarTextoModelo,
  telefoneParaEnvio,
  variaveisDoModelo,
  type Destino,
} from '@/lib/whatsapp/modelos';
import { maskCNJ } from '@/lib/masks';
import { titleCase } from '@/lib/formatters';

/**
 * O disparo: o broker escreve primeiro, pelo número da RGT, com modelo
 * aprovado pela Meta. Um clique, uma pessoa — nada em lote. Disparo em massa é
 * o padrão que a Meta pune e, com aposentado do outro lado, o que a OAB olha.
 * Cada envio guarda quem decidiu (`disparado_por_id`).
 */

export interface DadosDisparo {
  credorNome: string;
  credorTelefone: string | null;
  numeroProcesso: string | null;
  advogadoNome: string | null;
  advogadoOab: string | null;
  whatsappConectado: boolean;
}

/** O que a janela de envio mostra ao abrir. Lê com a permissão de quem pediu. */
export async function dadosParaDisparo(
  leadId: string,
): Promise<{ ok: true; dados: DadosDisparo } | { ok: false; error: string }> {
  const auth = await exigirPerfil(['admin', 'gestao', 'broker']);
  if (!auth.ok) return { ok: false, error: auth.error };

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from('leads')
    .select('nome, telefone, numero_processo')
    .eq('id', leadId)
    .maybeSingle<{ nome: string; telefone: string | null; numero_processo: string | null }>();
  if (!lead) return { ok: false, error: 'Lead não encontrado.' };

  const { data: prosp } = await supabase
    .from('prospeccao_precatorios')
    .select('advogado_nome, advogado_oab')
    .eq('lead_id', leadId)
    .maybeSingle<{ advogado_nome: string | null; advogado_oab: string | null }>();

  return {
    ok: true,
    dados: {
      // Nome da planilha e do DJEN vem em maiúscula. "Olá, Dr(a). ROSEMARY…"
      // numa mensagem fria parece golpe (visto no teste de 28/10).
      credorNome: titleCase(lead.nome),
      credorTelefone: lead.telefone,
      numeroProcesso: lead.numero_processo
        ? maskCNJ(lead.numero_processo.replace(/\D/g, ''))
        : null,
      advogadoNome: prosp?.advogado_nome ? titleCase(prosp.advogado_nome) : null,
      advogadoOab: prosp?.advogado_oab ?? null,
      whatsappConectado: whatsappConectado(),
    },
  };
}

const entradaSchema = z.object({
  leadId: z.string().uuid(),
  destino: z.enum(['credor', 'advogado']),
  nomeDestinatario: z.string().trim().min(2).max(80),
  telefone: z.string().max(30),
});

export async function dispararModelo(
  input: z.infer<typeof entradaSchema>,
): Promise<{ ok: true; conversaId: string } | { ok: false; error: string }> {
  const auth = await exigirPerfil(['admin', 'gestao', 'broker']);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Confira o nome e o telefone.' };
  const { leadId, destino, nomeDestinatario } = parsed.data;

  // Com a permissão de quem clicou: broker só dispara pra lead dele.
  const supabase = await createClient();
  const { data: lead } = await supabase
    .from('leads')
    .select('id, status, numero_processo')
    .eq('id', leadId)
    .maybeSingle<{ id: string; status: string; numero_processo: string | null }>();
  if (!lead) return { ok: false, error: 'Lead não encontrado.' };
  if (!lead.numero_processo) {
    return { ok: false, error: 'O lead precisa do número do processo: ele vai na mensagem.' };
  }

  const telefone = telefoneParaEnvio(parsed.data.telefone);
  if (!telefone) {
    return { ok: false, error: 'Telefone inválido. Precisa ser celular com DDD (11 dígitos).' };
  }
  if (!whatsappConectado()) {
    return { ok: false, error: 'O número da RGT ainda não está conectado ao WhatsApp.' };
  }

  const { data: eu } = await supabase
    .from('usuarios')
    .select('nome')
    .eq('id', auth.userId)
    .single<{ nome: string | null }>();
  if (!eu?.nome) return { ok: false, error: 'Seu usuário está sem nome: ele assina a mensagem.' };

  // Daqui em diante, service role: conversa e mensagem são escritas pelo
  // sistema. Quem decidiu fica registrado em disparado_por_id e autor_id.
  const sb = createServiceClient();

  const { data: saiu } = await sb.rpc('telefone_em_optout', { p_telefone: telefone });
  if (saiu) return { ok: false, error: 'Essa pessoa pediu pra não receber mais mensagens.' };

  const { data: existenteId } = await sb.rpc('conversa_por_telefone', { p_telefone: telefone });
  let conversa: { id: string; telefone: string } | null = null;

  if (existenteId) {
    const { data: c } = await sb
      .from('whatsapp_conversas')
      .select('id, telefone, janela_expira_em')
      .eq('id', existenteId as string)
      .single<{ id: string; telefone: string; janela_expira_em: string | null }>();
    if (c && estadoJanela(c.janela_expira_em).aberta) {
      return {
        ok: false,
        error: 'Essa pessoa escreveu nas últimas 24h: responda pela tela de Conversas, sem modelo.',
      };
    }
    const desde = new Date(Date.now() - INTERVALO_MINIMO_DIAS_MODELO * 86_400_000).toISOString();
    const { data: recente } = await sb
      .from('whatsapp_mensagens')
      .select('created_at')
      .eq('conversa_id', existenteId as string)
      .not('template_nome', 'is', null)
      .gte('created_at', desde)
      .limit(1)
      .maybeSingle<{ created_at: string }>();
    if (recente) {
      return {
        ok: false,
        error: `Essa pessoa já recebeu um modelo em ${new Date(recente.created_at).toLocaleDateString('pt-BR')}. Espere a resposta.`,
      };
    }
    conversa = c ? { id: c.id, telefone: c.telefone } : null;
  }

  const modelo = MODELOS[destino as Destino];
  const agora = new Date().toISOString();
  const semRobo = {
    bot_pausado: true,
    pausado_motivo: 'Contato com advogado: conversa direto com o broker, sem robô.',
    pausado_em: agora,
  };

  if (!conversa) {
    const { data: nova, error } = await sb
      .from('whatsapp_conversas')
      .insert({
        telefone,
        lead_id: leadId,
        disparado_por_id: auth.userId,
        roteiro: destino,
        status: 'aberta',
        ...(modelo.robo ? {} : semRobo),
      })
      .select('id, telefone')
      .single<{ id: string; telefone: string }>();
    if (error || !nova) return { ok: false, error: 'Não foi possível abrir a conversa.' };
    conversa = nova;
  } else {
    await sb
      .from('whatsapp_conversas')
      .update({
        disparado_por_id: auth.userId,
        roteiro: destino,
        ...(modelo.robo ? {} : semRobo),
      })
      .eq('id', conversa.id);
  }

  const vars = variaveisDoModelo({
    nomeDestinatario,
    nomeBroker: eu.nome,
    numeroProcesso: lead.numero_processo,
  });

  // Grava antes de enviar: se a Meta recusar, a tentativa fica registrada.
  const { data: msg, error: erroMsg } = await sb
    .from('whatsapp_mensagens')
    .insert({
      conversa_id: conversa.id,
      direcao: 'saida',
      autor: 'humano',
      autor_id: auth.userId,
      tipo: 'modelo',
      conteudo: montarTextoModelo(destino as Destino, vars),
      template_nome: modelo.nome,
      status_entrega: 'enviando',
    })
    .select('id')
    .single<{ id: string }>();
  if (erroMsg || !msg)
    return { ok: false, error: 'Não foi possível registrar o envio. Nada saiu.' };

  const envio = await enviarModelo(telefone, modelo, vars);

  await sb
    .from('whatsapp_mensagens')
    .update(
      envio.ok
        ? { wa_message_id: envio.waMessageId, status_entrega: 'enviada' }
        : { status_entrega: 'falhou' },
    )
    .eq('id', msg.id);

  if (!envio.ok) {
    revalidatePath('/conversas');
    return { ok: false, error: envio.erro };
  }

  // A conversa passa a ter o número como a Meta escreve (às vezes sem o nono
  // dígito). É o que o webhook vai informar quando a pessoa responder — com o
  // telefone da planilha, a resposta abriria uma segunda conversa.
  if (envio.waId && envio.waId !== conversa.telefone) {
    const { error } = await sb
      .from('whatsapp_conversas')
      .update({ telefone: envio.waId, wa_id: envio.waId })
      .eq('id', conversa.id);
    if (error) console.error('[whatsapp] wa_id não aplicado na conversa', error.message);
  }

  // Lead que só estava na coluna "Novo" passou a estar em contato.
  if (lead.status === 'novo') {
    await supabase.from('leads').update({ status: 'em_contato' }).eq('id', leadId);
  }

  revalidatePath('/conversas');
  revalidatePath('/crm');
  return { ok: true, conversaId: conversa.id };
}
