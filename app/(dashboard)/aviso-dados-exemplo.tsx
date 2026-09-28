import { FlaskConical } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

/**
 * Avisa que parte do que está na tela é demonstração.
 *
 * Fica no layout, não numa página: quem entra pela primeira vez costuma cair
 * direto em /operacoes ou /crm por um link, e o aviso precisa estar lá também.
 *
 * Some sozinho quando os dados de demo forem limpos — não é feature flag nem
 * configuração, é consequência do banco não ter mais registro marcado.
 */
export async function AvisoDadosExemplo() {
  const supabase = await createClient();

  const [{ count: ops }, { count: leads }] = await Promise.all([
    supabase.from('operacoes').select('id', { count: 'exact', head: true }).eq('is_exemplo', true),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('is_exemplo', true),
  ]);

  const totalOps = ops ?? 0;
  const totalLeads = leads ?? 0;
  if (totalOps === 0 && totalLeads === 0) return null;

  const partes: string[] = [];
  if (totalOps > 0) partes.push(`${totalOps} operaç${totalOps === 1 ? 'ão' : 'ões'}`);
  if (totalLeads > 0) partes.push(`${totalLeads} lead${totalLeads === 1 ? '' : 's'}`);

  return (
    <div className="mb-6 flex gap-3 rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
      <FlaskConical className="mt-0.5 size-4 shrink-0" />
      <div>
        <strong>{partes.join(' e ')} aqui dentro são exemplos</strong>, criados pra testar o
        sistema. Não são negócios reais da RGT — eles aparecem com um selo roxo escrito
        &quot;exemplo&quot;.
        <div className="mt-1 text-violet-800">
          O que é de verdade: os processos em Prospecção, que vieram da planilha do TRT19 e das
          publicações oficiais do CNJ.
        </div>
      </div>
    </div>
  );
}
