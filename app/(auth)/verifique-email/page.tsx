import Link from 'next/link';

export default async function VerifiqueEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <svg className="h-6 w-6 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold">Verifique seu email</h1>
      <p className="mt-3 text-sm text-neutral-600">
        Enviamos um email de confirmação {email && <>para <span className="font-mono text-neutral-900">{email}</span></>}.
      </p>
      <p className="mt-2 text-sm text-neutral-600">
        Clica no link do email para ativar sua conta. Depois disso você poderá entrar.
      </p>
      <div className="mt-6 rounded-md bg-neutral-50 p-3 text-xs text-neutral-500">
        Não achou o email? Confere a pasta de spam. O remetente é <span className="font-mono">noreply@mail.supabase.io</span>.
      </div>
      <div className="mt-6">
        <Link href="/login" className="text-sm font-medium text-neutral-900 hover:underline">
          Voltar pro login
        </Link>
      </div>
    </div>
  );
}
