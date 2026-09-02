'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export function ToastNovaOperacao() {
  const [visivel, setVisivel] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const t = setTimeout(() => {
      setVisivel(false);
      // Remove ?nova=1 da URL sem recarregar (só cosmético)
      router.replace(pathname);
    }, 5000);
    return () => clearTimeout(t);
  }, [router, pathname]);

  if (!visivel) return null;

  return (
    <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
      Operação cadastrada com sucesso.
    </div>
  );
}
