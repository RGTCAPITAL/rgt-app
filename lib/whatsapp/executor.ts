import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';
import { fmtTelefone } from '@/lib/formatters';
import { enviarTexto } from './cloud-api';
import type { AutorMensagem } from './conversas';
import type { AvisoModelo, MensagemRecebida, StatusRecebido } from './webhook-meta';
import { resumirAvisoModelo, statusAvanca } from './webhook-meta';
import { decidirProximoPasso, type MensagemHistorico, type PlanoRobo } from './robo/decidir';
import { chamarClaude } from './robo/claude';
import type { DadosColetados } from './robo/schema';

/**
 * Aplica o robô no mundo: banco, WhatsApp e notificação. Roda no webhook, sem
 * usuário logado, por isso service role — e por isso cada escrita aqui é
 * deliberada. O que decide é `decidirProximoPasso`; este módulo só obedece.
 */

const JANELA_MS = 24 * 60 * 60 * 1000;
const HISTORICO_MAX = 40;

type Conversa = {
  id: string;
  telefone: string;
  lead_id: string | null;
  bot_pausado: boolean;
  status: string;
  nome_perfil: string | null;
  recusas_preco: number;
  nao_entendidas: number;
  dados_coletados: DadosColetados | null;
};

const COLUNAS =
  'id, telefone, lead_id, bot_pausado, status, nome_perfil, recusas_preco, nao_entendidas, dados_coletados';

async function acharOuCriarConversa(sb: SupabaseClient, m: MensagemRecebida): Promise<Conversa> {
  const { data: existente } = await sb
    .from('whatsapp_conversas')
    .select(COLUNAS)
    .eq('telefone', m.telefone)
    .maybeSingle<Conversa>();
  if (existente) return existente;

  // Conversa nova: liga ao lead pelo telefone, tolerando máscara, DDI e o
  // nono dígito que a Meta às vezes omite (função da migration 045).
  const { data: leadId } = await sb.rpc('lead_por_telefone', { p_telefone: m.telefone });

  const { data: criada, error } = await sb
    .from('whatsapp_conversas')
    .insert({
      telefone: m.telefone,
      wa_id: m.telefone,
      nome_perfil: m.nomePerfil,
      lead_id: (leadId as string | null) ?? null,
    })
    .select(COLUNAS)
    .single<Conversa>();

  if (criada) {
    if (criada.lead_id) return criada;
    // Ninguém conhecia esse número: escreveu direto, sem formulário. Vira lead
    // já na primeira mensagem, senão a conversa não aparece pra broker nenhum
    // (a RLS de /conversas passa pelo dono do lead) e some do CRM. Criado
    // DEPOIS da conversa: se duas mensagens chegam juntas, só quem criou a
    // conversa cria o lead — não sobra lead duplicado.
    const leadNovo = await criarLeadDoWhatsapp(sb, m);
    if (leadNovo) {
      await sb.from('whatsapp_conversas').update({ lead_id: leadNovo }).eq('id', criada.id);
      criada.lead_id = leadNovo;
      await notificar(sb, criada, {
        titulo: `Novo contato pelo WhatsApp: ${m.nomePerfil ?? `+${m.telefone}`}`,
        descricao:
          'Escreveu direto no número da RGT. O robô está atendendo; o lead está no CRM sem dono.',
        urgente: false,
      });
    }
    return criada;
  }
  // Duas mensagens da mesma pessoa chegando juntas: a outra criou primeiro.
  if (error?.code === '23505') {
    const { data } = await sb
      .from('whatsapp_conversas')
      .select(COLUNAS)
      .eq('telefone', m.telefone)
      .single<Conversa>();
    if (data) return data;
  }
  throw new Error(`não foi possível criar a conversa: ${error?.message}`);
}

/** Lead mínimo de quem escreveu direto. Admin ou gestão distribuem depois. */
async function criarLeadDoWhatsapp(
  sb: SupabaseClient,
  m: MensagemRecebida,
): Promise<string | null> {
  // Leads guardam telefone sem o 55, como o formulário do site.
  const t = m.telefone;
  const nacional = (t.length === 12 || t.length === 13) && t.startsWith('55') ? t.slice(2) : t;
  const { data, error } = await sb
    .from('leads')
    .insert({
      nome: m.nomePerfil?.trim() || `WhatsApp ${fmtTelefone(nacional)}`,
      telefone: nacional,
      origem: 'whatsapp',
      status: 'novo',
      notas: 'Escreveu direto no WhatsApp da RGT. O robô atendeu primeiro.',
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !data) {
    console.error('[whatsapp] não criou o lead do contato novo', error?.message);
    return null;
  }
  return data.id;
}

/**
 * Quem recebe o aviso: o dono do lead. Sem dono — número que ninguém conhece,
 * lead sem broker — vai pra admin e gestão, senão a conversa fica órfã. Se é
 * urgente, admin recebe sempre.
 */
async function destinatarios(
  sb: SupabaseClient,
  leadId: string | null,
  urgente: boolean,
): Promise<string[]> {
  let dono: string | null = null;
  if (leadId) {
    const { data } = await sb.from('leads').select('dono_id').eq('id', leadId).maybeSingle();
    dono = (data?.dono_id as string | null) ?? null;
  }

  const ids = new Set<string>(dono ? [dono] : []);
  if (!dono || urgente) {
    const { data: perfis } = await sb
      .from('perfis')
      .select('id')
      .in('slug', urgente && dono ? ['admin'] : ['admin', 'gestao']);
    const { data: equipe } = await sb
      .from('usuarios')
      .select('id')
      .eq('ativo', true)
      .in(
        'perfil_id',
        (perfis ?? []).map((p) => p.id),
      );
    for (const u of equipe ?? []) ids.add(u.id as string);
  }
  return [...ids];
}

async function notificar(
  sb: SupabaseClient,
  conversa: Conversa,
  aviso: { titulo: string; descricao: string; urgente: boolean },
) {
  const link = `/conversas?c=${conversa.id}`;
  const para = await destinatarios(sb, conversa.lead_id, aviso.urgente);
  if (!para.length) return;

  // Uma pessoa mandando dez mensagens seguidas não pode virar dez avisos.
  // Quem ainda não leu o aviso desta conversa não recebe outro.
  const { data: pendentes } = await sb
    .from('notificacoes')
    .select('destinatario')
    .eq('link', link)
    .is('lida_em', null)
    .in('destinatario', para);
  const jaAvisados = new Set((pendentes ?? []).map((n) => n.destinatario as string));

  const novos = para
    .filter((id) => aviso.urgente || !jaAvisados.has(id))
    .map((destinatario) => ({
      destinatario,
      tipo: 'whatsapp',
      titulo: aviso.titulo,
      descricao: aviso.descricao,
      link,
    }));
  if (!novos.length) return;

  const { error } = await sb.from('notificacoes').insert(novos);
  if (error) console.error('[whatsapp] notificação falhou', error.message);
}

async function nomeDaPessoa(sb: SupabaseClient, conversa: Conversa): Promise<string> {
  if (conversa.lead_id) {
    const { data } = await sb.from('leads').select('nome').eq('id', conversa.lead_id).maybeSingle();
    if (data?.nome) return data.nome as string;
  }
  return conversa.nome_perfil ?? `+${conversa.telefone}`;
}

/** Grava antes de enviar, atualiza depois: a prova existe mesmo se a Meta falhar. */
async function enviarComoRobo(sb: SupabaseClient, conversa: Conversa, texto: string) {
  const { data: msg, error } = await sb
    .from('whatsapp_mensagens')
    .insert({
      conversa_id: conversa.id,
      direcao: 'saida',
      autor: 'bot',
      tipo: 'texto',
      conteudo: texto,
      status_entrega: 'enviando',
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !msg) {
    console.error('[whatsapp] não gravou a resposta do robô; nada enviado', error?.message);
    return;
  }

  const envio = await enviarTexto(conversa.telefone, texto);
  await sb
    .from('whatsapp_mensagens')
    .update(
      envio.ok
        ? { wa_message_id: envio.waMessageId, status_entrega: 'enviada' }
        : { status_entrega: 'falhou' },
    )
    .eq('id', msg.id);
}

async function contextoDoProcesso(sb: SupabaseClient, leadId: string | null) {
  if (!leadId) return null;
  const [{ data: lead }, { data: prosp }] = await Promise.all([
    sb.from('leads').select('nome, ente_devedor, numero_processo').eq('id', leadId).maybeSingle(),
    sb.from('prospeccao_precatorios').select('tribunal').eq('lead_id', leadId).maybeSingle(),
  ]);
  if (!lead) return null;
  return {
    credor: (lead.nome as string | null) ?? null,
    tribunal: (prosp?.tribunal as string | null) ?? null,
    ente_devedor: (lead.ente_devedor as string | null) ?? null,
    numero_processo: (lead.numero_processo as string | null) ?? null,
  };
}

async function historico(sb: SupabaseClient, conversaId: string): Promise<MensagemHistorico[]> {
  const { data } = await sb
    .from('whatsapp_mensagens')
    .select('autor, conteudo, tipo')
    .eq('conversa_id', conversaId)
    .order('created_at', { ascending: false })
    .limit(HISTORICO_MAX);
  return (data ?? []).reverse().map((m) => ({
    autor: m.autor as AutorMensagem,
    // Mídia sem legenda aparece pro robô como o que é, não como vazio.
    conteudo: (m.conteudo as string | null) ?? `[${m.tipo as string}]`,
  }));
}

export async function processarMensagemRecebida(m: MensagemRecebida): Promise<void> {
  const sb = createServiceClient();
  const conversa = await acharOuCriarConversa(sb, m);

  const { error: erroGravar } = await sb.from('whatsapp_mensagens').insert({
    conversa_id: conversa.id,
    wa_message_id: m.waMessageId,
    direcao: 'entrada',
    autor: 'contato',
    tipo: m.tipo,
    conteudo: m.conteudo,
    midia_id: m.midiaId,
    bruto: m.bruto,
    created_at: m.recebidaEm,
  });
  // A Meta reenvia quando não recebe 200 a tempo. Já gravada = já tratada.
  if (erroGravar?.code === '23505') return;
  if (erroGravar) throw new Error(`não gravou a mensagem recebida: ${erroGravar.message}`);

  await sb
    .from('whatsapp_conversas')
    .update({
      janela_expira_em: new Date(new Date(m.recebidaEm).getTime() + JANELA_MS).toISOString(),
      nome_perfil: m.nomePerfil ?? conversa.nome_perfil,
    })
    .eq('id', conversa.id);

  // Quem saiu não recebe nada, nem do robô. A mensagem fica registrada.
  const { data: saiu } = await sb
    .from('whatsapp_optout')
    .select('id')
    .eq('telefone', conversa.telefone)
    .maybeSingle();
  if (saiu) return;

  const nome = await nomeDaPessoa(sb, conversa);

  if (conversa.bot_pausado || conversa.status !== 'aberta') {
    const previa = m.conteudo ?? `[${m.tipo}]`;
    await notificar(sb, conversa, {
      titulo: `Nova mensagem de ${nome}`,
      descricao: previa.length > 90 ? `${previa.slice(0, 87)}…` : previa,
      urgente: false,
    });
    return;
  }

  const plano = await decidirProximoPasso(
    {
      historico: await historico(sb, conversa.id),
      ctx: {
        recusasDePreco: conversa.recusas_preco,
        naoEntendidasSeguidas: conversa.nao_entendidas,
        tipoMensagem: m.tipo,
        // Idade ainda não está no lead. Quando estiver, o freio de 75+ liga.
        idadeTitular: null,
      },
      processo: await contextoDoProcesso(sb, conversa.lead_id),
    },
    async (entrada) => (await chamarClaude(entrada)).decisao,
  );

  // A pessoa mandou outra mensagem enquanto o robô pensava: a chamada daquela
  // mensagem responde as duas juntas. Esta só não fala — freio de segurança
  // (pausa, opt-out) ainda vale, porque pode ter sido justamente o "SAIR".
  const { data: maisNova } = await sb
    .from('whatsapp_mensagens')
    .select('wa_message_id')
    .eq('conversa_id', conversa.id)
    .eq('autor', 'contato')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const atropelada = maisNova?.wa_message_id !== m.waMessageId;

  await aplicarPlano(sb, conversa, plano, nome, atropelada);
}

async function aplicarPlano(
  sb: SupabaseClient,
  conversa: Conversa,
  plano: PlanoRobo,
  nome: string,
  atropelada: boolean,
) {
  if (atropelada && !plano.pausar && !plano.optout) return;

  if (plano.optout) {
    const { error } = await sb
      .from('whatsapp_optout')
      .insert({ telefone: conversa.telefone, motivo: 'Pediu pelo WhatsApp', origem: 'contato' });
    if (error && error.code !== '23505') console.error('[whatsapp] opt-out falhou', error.message);
  }

  if (plano.enviar) await enviarComoRobo(sb, conversa, plano.enviar);

  const agora = new Date().toISOString();
  await sb
    .from('whatsapp_conversas')
    .update({
      recusas_preco: conversa.recusas_preco + (plano.recusouPreco ? 1 : 0),
      nao_entendidas: plano.naoEntendeu ? conversa.nao_entendidas + 1 : 0,
      ...(plano.dados ? { dados_coletados: plano.dados } : {}),
      ...(plano.pausar || plano.optout
        ? {
            bot_pausado: true,
            pausado_motivo: plano.optout ? 'A pessoa pediu pra sair.' : plano.pausar!.motivo,
            pausado_em: agora,
            status: plano.optout ? 'encerrada' : 'aguardando_humano',
          }
        : {}),
    })
    .eq('id', conversa.id);

  // O que a pessoa contou do processo vai pro cartão do CRM — mas só em campo
  // vazio: o que veio do formulário ou da prospecção vale mais que a lembrança.
  if (conversa.lead_id && plano.dados) {
    const d = plano.dados;
    if (d.devedor_informado) {
      await sb
        .from('leads')
        .update({ ente_devedor: d.devedor_informado })
        .eq('id', conversa.lead_id)
        .is('ente_devedor', null);
    }
    const digitos = d.numero_processo_informado?.replace(/\D/g, '') ?? '';
    // Só CNJ de 20 dígitos vai pro lead: a regra de integridade do banco
    // recusa texto livre ("não lembro, tá com o advogado" — testado em 28/10).
    // O que não for número válido fica nos dados da conversa, onde o broker vê.
    if (digitos.length === 20) {
      const { error } = await sb
        .from('leads')
        .update({ numero_processo: digitos })
        .eq('id', conversa.lead_id)
        .is('numero_processo', null);
      // Dígito verificador errado também é recusado. Não é falha do robô:
      // o número segue nos dados da conversa.
      if (error) console.warn('[whatsapp] número de processo não gravado no lead', error.message);
    }
  }

  if (plano.pausar && !plano.optout) {
    await notificar(sb, conversa, {
      titulo: plano.pausar.urgente
        ? `URGENTE: ${nome} precisa de atenção`
        : `Conversa esperando você: ${nome}`,
      descricao: plano.pausar.motivo,
      urgente: plano.pausar.urgente,
    });
  }
}

export async function processarStatus(s: StatusRecebido): Promise<void> {
  const sb = createServiceClient();
  const { data: msg } = await sb
    .from('whatsapp_mensagens')
    .select('id, status_entrega')
    .eq('wa_message_id', s.waMessageId)
    .maybeSingle();
  // Status de mensagem que não está no banco (enviada por fora) é ignorado.
  if (!msg || !statusAvanca(msg.status_entrega as string | null, s.status)) return;
  await sb.from('whatsapp_mensagens').update({ status_entrega: s.status }).eq('id', msg.id);
}

/**
 * Aviso de modelo (aprovado, recusado, pausado, qualidade) vai pros admins:
 * modelo é coisa da conta da Meta, não de uma conversa. Ver
 * `resumirAvisoModelo` pra o que é urgente.
 */
export async function processarAvisoModelo(a: AvisoModelo): Promise<void> {
  const texto = resumirAvisoModelo(a);
  console.info('[whatsapp] modelo', a.modelo, a.tipo, a.valor, a.motivo ?? '');
  if (!texto) return;

  const sb = createServiceClient();
  const { data: perfis } = await sb.from('perfis').select('id').eq('slug', 'admin');
  const { data: admins } = await sb
    .from('usuarios')
    .select('id')
    .eq('ativo', true)
    .in(
      'perfil_id',
      (perfis ?? []).map((p) => p.id),
    );
  if (!admins?.length) return;

  const { error } = await sb.from('notificacoes').insert(
    admins.map((u) => ({
      destinatario: u.id as string,
      tipo: 'whatsapp',
      titulo: texto.urgente ? `URGENTE: ${texto.titulo}` : texto.titulo,
      descricao: texto.descricao,
      link: '/admin/robo',
    })),
  );
  if (error) console.error('[whatsapp] aviso de modelo não gravado', error.message);
}
