import Link from 'next/link';
import { updatePassword } from './actions';

export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold">Nova senha</h1>
      <p className="mb-6 text-sm text-neutral-600">
        Escolha uma senha nova para sua conta.
      </p>
      <form action={updatePassword} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-neutral-700">Nova senha</span>
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
        {message && <p className="text-sm text-green-700">{message}</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Salvar nova senha
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
