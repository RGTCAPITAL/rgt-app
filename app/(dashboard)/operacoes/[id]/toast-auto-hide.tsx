'use client';

import { useEffect, useState } from 'react';

/**
 * Auto-hide após 5s. NÃO faz router.replace pra evitar race com
 * revalidatePath do server action (que remontaria o toast). O ?nova=1
 * na URL some naturalmente na próxima navegação do user.
 */
export function ToastNovaOperacao() {
  const [visivel, setVisivel] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisivel(false), 5000);
    return () => clearTimeout(t);
  }, []);

  if (!visivel) return null;

  return (
    <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
      Operação cadastrada com sucesso.
    </div>
  );
}
