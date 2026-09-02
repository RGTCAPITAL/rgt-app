'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * Dispara toast do sonner ao montar. Renderiza nada — só efeito colateral.
 * Mantém o comportamento anterior (?nova=1 → toast) sem banner inline.
 */
export function ToastNovaOperacao() {
  useEffect(() => {
    toast.success('Operação cadastrada com sucesso.');
  }, []);

  return null;
}
