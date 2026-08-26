import Link from 'next/link';
import { signIn } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Entrar</h1>
      <form action={signIn} className="space-y-4">
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
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-700">{message}</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Entrar
        </button>
      </form>
      <div className="mt-6 space-y-3 text-center text-sm">
        <div>
          <Link href="/esqueci-senha" className="text-neutral-600 hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <div className="text-neutral-600">
          Não tem conta?{' '}
          <Link href="/cadastro" className="font-medium text-neutral-900 hover:underline">
            Cadastre-se
          </Link>
        </div>
      </div>
    </div>
  );
}
