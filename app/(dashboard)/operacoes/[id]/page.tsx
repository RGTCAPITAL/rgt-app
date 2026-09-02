import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function OperacaoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: op, error } = await supabase
    .from('operacoes')
    .select(
      'id, numero_processo, tipo, esfera, natureza, especie, tribunal, valor_total, cedente_nome, cedente_cpf, etapa_atual, created_at, ente_devedor:entes_devedores(nome)',
    )
    .eq('id', id)
    .single<{
      id: string;
      numero_processo: string;
      tipo: string;
      esfera: string;
      natureza: string;
      especie: string;
      tribunal: string;
      valor_total: number;
      cedente_nome: string;
      cedente_cpf: string;
      etapa_atual: string;
      created_at: string;
      ente_devedor: { nome: string } | null;
    }>();

  if (error || !op) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link href="/operacoes" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Operações
        </Link>
      </div>

      <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        Operação cadastrada com sucesso.
      </div>

      <h1 className="text-2xl font-bold tracking-tight">Operação {op.numero_processo}</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Cedente: <strong>{op.cedente_nome}</strong> — Etapa atual:{' '}
        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium">{op.etapa_atual}</span>
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-neutral-200 p-4 text-sm">
        <Item label="Tipo" value={op.tipo} />
        <Item label="Esfera" value={op.esfera} />
        <Item label="Natureza" value={op.natureza} />
        <Item label="Espécie" value={op.especie} />
        <Item label="Tribunal" value={op.tribunal} />
        <Item label="Ente devedor" value={op.ente_devedor?.nome ?? '—'} />
        <Item
          label="Valor total"
          value={Number(op.valor_total).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          })}
        />
        <Item label="Criada em" value={new Date(op.created_at).toLocaleString('pt-BR')} />
      </dl>

      <p className="mt-6 text-xs text-neutral-500">
        Workflow visual e histórico de etapas: implementação em RGT-19.
      </p>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium text-neutral-900">{value}</dd>
    </>
  );
}
