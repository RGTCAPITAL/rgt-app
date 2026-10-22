'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { hojeEmSaoPaulo, somarDias } from '@/lib/datas';

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Agendar retorno de lead.
 *
 * Isto era impossível até a migration 038: `tarefas.operacao_id` era NOT NULL,
 * e lead não é operação. O broker trabalhava de memória, e lead sem retorno
 * marcado é lead perdido.
 */

// Os atalhos de prazo moram no componente, não aqui: um arquivo 'use server'
// só pode exportar funções async. Exportar uma constante daqui faz o Next
// entregar ao cliente algo que não é array, e o .map quebra em runtime —
// erro que nem o build nem os testes pegam, só o clique.

/**
 * Converte o atalho em data.
 *
 * Fica no servidor de propósito: o relógio do navegador do usuário pode estar
 * em outro fuso ou simplesmente errado, e prazo de follow-up é compromisso.
 */
function resolverPrazo(atalho: string): string | null {
  const dias: Record<string, number> = { hoje: 0, amanha: 1, '2d': 2, '1s': 7, '15d': 15 };
  if (!(atalho in dias)) return null;
  // Em UTC, "hoje" depois das 21h em Maceió já era amanhã, e o retorno caía
  // um dia depois do que o broker clicou.
  return somarDias(hojeEmSaoPaulo(), dias[atalho]!);
}

export async function agendarRetornoLead(
  leadId: string,
  titulo: string,
  prazoAtalho: string,
  dataManual: string | null,
): Promise<Result<{ prazo: string }>> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const tituloLimpo = titulo.trim();
  if (tituloLimpo.length < 3) {
    return { ok: false, error: 'Descreva o retorno em pelo menos 3 caracteres.' };
  }

  const prazo = dataManual || resolverPrazo(prazoAtalho);
  if (!prazo) return { ok: false, error: 'Prazo inválido.' };

  // O lead precisa existir E ser visível pra quem está agendando. A RLS de
  // leads já cuida disso: broker enxerga só os próprios, então este select
  // volta vazio se ele tentar agendar no lead de outro.
  const { data: lead } = await supabase
    .from('leads')
    .select('id, nome, dono_id')
    .eq('id', leadId)
    .maybeSingle<{ id: string; nome: string; dono_id: string | null }>();

  if (!lead) {
    return { ok: false, error: 'Lead não encontrado ou fora do seu acesso.' };
  }

  // O retorno é de quem trabalha o lead. Sem dono, fica com quem agendou —
  // melhor um responsável do que nenhum.
  const destinatario = lead.dono_id ?? user.id;

  const { error } = await supabase.from('tarefas').insert({
    lead_id: leadId,
    operacao_id: null,
    titulo: tituloLimpo,
    criado_por_id: user.id,
    destinatario_id: destinatario,
    prazo,
    status: 'pendente',
  });

  if (error) {
    console.error('[crm] falha ao agendar retorno', error);
    return { ok: false, error: 'Não consegui agendar o retorno. Tente de novo.' };
  }

  revalidatePath('/crm');
  revalidatePath('/tarefas');
  return { ok: true, data: { prazo } };
}

export async function concluirRetorno(tarefaId: string): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { error } = await supabase
    .from('tarefas')
    // concluida_por_id é exigido pelo CHECK tarefas_concluida_coerencia: sem ele
    // o update falhava, e por isso nenhuma tela chegou a usar esta ação.
    .update({
      status: 'concluida',
      concluida_em: new Date().toISOString(),
      concluida_por_id: user.id,
    })
    .eq('id', tarefaId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/crm');
  revalidatePath('/tarefas');
  return { ok: true };
}
