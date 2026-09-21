import Image from 'next/image';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          {/* Login é a primeira tela que o usuário vê — logo maior que na
              sidebar (h-12 aqui vs h-8 lá). Logo horizontal do site, sem
              adicionar "app" pra não competir com a marca. */}
          <Image
            src="/logo-header.png"
            alt="RGT Capital"
            width={175}
            height={48}
            priority
            className="h-12 w-auto"
          />
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
