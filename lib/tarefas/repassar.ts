import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Lead que troca de dono leva junto as tarefas abertas que as regras
 * automáticas criaram pra ele. Sem isso a tarefa ficava com o dono antigo,
 * que nem enxerga mais o lead (a RLS de leads é por dono), e o novo dono não
 * sabia que havia follow-up a fazer.
 *
 * Só tarefa de regra (criado_por_id nulo). A que uma pessoa escreveu foi
 * endereçada de propósito a alguém, e quem decide repassar é ela.
 */

const ABERTAS = ['pendente', 'em_andamento'] as const;

/**
 * Mesmo critério de quem a regra escolhe ao criar a tarefa (decidir.ts): lead
 * sem dono vai pra gestão. O CHECK tarefas_destinatario exige um dos dois.
 */
export function destinoDaTarefaDeRegra(donoId: string | null) {
  return donoId
    ? { destinatario_id: donoId, destinatario_perfil: null }
    : { destinatario_id: null, destinatario_perfil: 'gestao' as const };
}

/**
 * Chame só DEPOIS de gravar o novo dono, com o mesmo cliente (com RLS) da
 * action. Não lança: a troca de dono já valeu e não deve ser desfeita por
 * isto; a falha vai pro log da Vercel.
 */
export async function repassarTarefasDeRegra(
  supabase: SupabaseClient,
  leadId: string,
  novoDonoId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('tarefas')
    .update(destinoDaTarefaDeRegra(novoDonoId))
    .eq('lead_id', leadId)
    .is('criado_por_id', null)
    .in('status', ABERTAS);
  if (error) {
    console.error(
      `[tarefas] lead ${leadId} trocou de dono, mas as tarefas de regra ficaram com o anterior:`,
      error.message,
    );
  }
}
