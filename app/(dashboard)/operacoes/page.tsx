import Link from 'next/link';

export default function OperacoesPage() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Operações</h1>
          <p className="mt-2 text-neutral-600">Gestão de operações de precatórios (P1).</p>
        </div>
        <Link
          href="/operacoes/nova"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          + Nova operação
        </Link>
      </div>

      <p className="mt-8 text-sm text-neutral-500">
        Lista de operações: implementação em RGT-16.
      </p>
    </div>
  );
}
