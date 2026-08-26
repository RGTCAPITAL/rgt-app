import Link from 'next/link';
import { resetPassword } from './actions';

export default async function EsqueciSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold">Esqueci minha senha</h1>
      <p className="mb-6 text-sm text-neutral-600">
        Vamos enviar um link pro seu email pra você criar uma nova senha.
      </p>
      <form action={resetPassword} className="space-y-4">
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
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-700">{message}</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Enviar link de reset
        </button>
      </form>
      <div className="mt-6 text-center text-sm text-neutral-600">
        <Link href="/login" className="font-medium text-neutral-900 hover:underline">
          Voltar pro login
        </Link>
      </div>
    </div>
  );
}
