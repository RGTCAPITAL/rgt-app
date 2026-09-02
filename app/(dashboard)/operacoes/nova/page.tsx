import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { NovaOperacaoForm } from './nova-operacao-form';
import type { Esfera } from '@/lib/tribunais';

type Search = { lead_id?: string };

export default async function NovaOperacaoPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { lead_id } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug, permissoes)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string; permissoes: Record<string, unknown> | null } | null }>();

  const podeMunicipal = Boolean(usuario?.perfil?.permissoes?.['pode_esfera_municipal']);

  const { data: entes } = await supabase
    .from('entes_devedores')
    .select('id, nome, esfera, uf')
    .eq('ativo', true)
    .order('esfera')
    .order('nome')
    .returns<{ id: string; nome: string; esfera: Esfera; uf: string | null }[]>();

  // Se veio de um lead, pré-preenche cedente
  let leadInicial: { id: string; nome: string; cpf: string } | null = null;
  if (lead_id) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, nome, cpf_cnpj, status, operacao_id')
      .eq('id', lead_id)
      .single<{
        id: string;
        nome: string;
        cpf_cnpj: string | null;
        status: string;
        operacao_id: string | null;
      }>();

    // Só permite se lead existe e ainda não virou operação
    if (lead && !lead.operacao_id && lead.status !== 'ganho') {
      leadInicial = {
        id: lead.id,
        nome: lead.nome,
        cpf: (lead.cpf_cnpj ?? '').length === 11 ? (lead.cpf_cnpj ?? '') : '',
      };
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nova operação</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {leadInicial
              ? `Vindo do lead "${leadInicial.nome}" — dados pré-preenchidos.`
              : 'Cadastre um precatório, RPV ou direito creditório em 3 passos.'}
          </p>
        </div>
        <Link
          href={leadInicial ? '/crm' : '/operacoes'}
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Cancelar
        </Link>
      </div>

      <NovaOperacaoForm
        entesDevedores={entes ?? []}
        podeMunicipal={podeMunicipal}
        leadInicial={leadInicial}
      />
    </div>
  );
}
