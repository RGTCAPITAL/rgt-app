import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getSession();

  const supabaseOk = !error;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold tracking-tight">Hello RGT</h1>
      <p className="mt-2 text-neutral-600">
        Setup inicial funcionando. Este é o placeholder do Dashboard.
      </p>

      <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Diagnóstico
        </h2>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-neutral-500">Next.js</dt>
          <dd className="font-mono">ok</dd>
          <dt className="text-neutral-500">Supabase URL</dt>
          <dd className="font-mono break-all">{url ?? '❌ faltando'}</dd>
          <dt className="text-neutral-500">Conexão Supabase</dt>
          <dd className="font-mono">{supabaseOk ? '✅ ok' : '❌ ' + (error?.message ?? 'erro')}</dd>
          <dt className="text-neutral-500">Sessão</dt>
          <dd className="font-mono">
            {data?.session ? 'logado' : 'sem sessão (esperado — auth ainda não implementado)'}
          </dd>
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Próximos passos
        </h2>
        <ul className="mt-3 space-y-1 text-sm text-neutral-700">
          <li>• Criar tabelas no Supabase (operacoes, leads, interacoes)</li>
          <li>• Implementar login (auth por email/magic link)</li>
          <li>• Construir tela de listagem de Operações</li>
          <li>• Construir Kanban do CRM</li>
        </ul>
      </section>
    </div>
  );
}
