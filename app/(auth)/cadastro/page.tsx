import Link from 'next/link';
import { signUp } from './actions';

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Criar conta</h1>
      <form action={signUp} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-neutral-700">Nome</span>
          <input
            name="nome"
            type="text"
            required
            autoComplete="name"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-neutral-700">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-neutral-700">Senha</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          />
          <span className="mt-1 block text-xs text-neutral-500">Mínimo 8 caracteres</span>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Criar conta
        </button>
      </form>
      <div className="mt-6 text-center text-sm text-neutral-600">
        Já tem conta?{' '}
        <Link href="/login" className="font-medium text-neutral-900 hover:underline">
          Entrar
        </Link>
      </div>
    </div>
  );
}
