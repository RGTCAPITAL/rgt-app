'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

/**
 * Erro do login limpa quando user começa nova tentativa (focus em input)
 * OU após 8s, o que vier primeiro. Evita "erro preso" na tela quando
 * o Next mantém render antigo entre navegações.
 */
export function LoginError({ initialError }: { initialError: string | null }) {
  const [erro, setErro] = useState(initialError);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    if (!initialError) return;
    const t = setTimeout(() => setErro(null), 8000);
    return () => clearTimeout(t);
  }, [initialError]);

  useEffect(() => {
    if (!erro) return;
    function limpar() {
      setErro(null);
      const p = new URLSearchParams(params.toString());
      p.delete('error');
      router.replace(p.toString() ? `${pathname}?${p.toString()}` : pathname);
    }
    const inputs = document.querySelectorAll('input');
    inputs.forEach((i) => i.addEventListener('focus', limpar, { once: true }));
    return () => inputs.forEach((i) => i.removeEventListener('focus', limpar));
  }, [erro, router, pathname, params]);

  if (!erro) return null;
  return <p className="text-sm text-red-600">{erro}</p>;
}
