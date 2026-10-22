'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { concluirRetorno } from '../crm/retorno-actions';

/**
 * Concluir um retorno de lead direto da Central de Tarefas.
 *
 * Tarefa de operação muda de status dentro da aba Tarefas da operação; o
 * retorno agendado no CRM não tem operação, então sem este botão ele ficava
 * pendente pra sempre.
 */
export function ConcluirRetorno({ tarefaId }: { tarefaId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await concluirRetorno(tarefaId);
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success('Retorno concluído');
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <Check className="size-3.5" />}
      Concluir
    </Button>
  );
}
