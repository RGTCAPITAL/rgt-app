'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Hand } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { assumirConversa } from './actions';

/** Tira o robô da conversa. Não tem "devolver": o robô não volta sozinho. */
export function AssumirConversa({
  conversaId,
  desligado,
}: {
  conversaId: string;
  desligado?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending || desligado}
      onClick={() =>
        startTransition(async () => {
          const r = await assumirConversa(conversaId);
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success('Robô parado. A conversa é sua.');
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <Hand className="size-3.5" />}
      Assumir conversa
    </Button>
  );
}
