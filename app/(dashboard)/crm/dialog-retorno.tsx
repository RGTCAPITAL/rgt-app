'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { agendarRetornoLead } from './retorno-actions';

/**
 * Agendar retorno de um lead.
 *
 * Os atalhos de prazo existem porque esse é o gesto mais repetido do dia de
 * um broker: ligou, não atendeu, retorna amanhã. Obrigá-lo a abrir um seletor
 * de data pra isso faz ele parar de agendar — e lead sem retorno marcado é
 * lead perdido.
 */

/**
 * Atalhos de prazo. Moram aqui e não na action porque arquivo 'use server'
 * só exporta função async — uma constante exportada de lá chega ao cliente
 * como outra coisa e quebra no .map.
 *
 * Os valores cobrem o gesto mais repetido do dia de um broker: ligou, não
 * atendeu, retorna amanhã.
 */
const PRAZOS_RETORNO = [
  { valor: 'hoje', label: 'Hoje' },
  { valor: 'amanha', label: 'Amanhã' },
  { valor: '2d', label: 'Em 2 dias' },
  { valor: '1s', label: 'Em 1 semana' },
  { valor: '15d', label: 'Em 15 dias' },
] as const;

const SUGESTOES = [
  'Retornar ligação',
  'Enviar proposta',
  'Cobrar documentos',
  'Confirmar interesse',
];

export function DialogRetorno({
  lead,
  onFechar,
}: {
  lead: { id: string; nome: string } | null;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [titulo, setTitulo] = useState('Retornar ligação');
  const [prazo, setPrazo] = useState<string>('amanha');
  const [dataManual, setDataManual] = useState('');
  const [pending, startTransition] = useTransition();

  function agendar() {
    if (!lead) return;
    startTransition(async () => {
      const res = await agendarRetornoLead(lead.id, titulo, prazo, dataManual || null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const quando = new Date(res.data!.prazo + 'T12:00:00').toLocaleDateString('pt-BR');
      toast.success(`Retorno agendado para ${quando}`);
      setTitulo('Retornar ligação');
      setPrazo('amanha');
      setDataManual('');
      onFechar();
      router.refresh();
    });
  }

  return (
    <Dialog open={lead !== null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4" />
            Agendar retorno
          </DialogTitle>
        </DialogHeader>

        {lead && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-600">
              Para <strong className="text-neutral-900">{lead.nome}</strong>. Vai aparecer na lista
              de tarefas de quem trabalha esse lead.
            </p>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="titulo-retorno">O que fazer</Label>
              <Input
                id="titulo-retorno"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                disabled={pending}
              />
              <div className="flex flex-wrap gap-1 pt-1">
                {SUGESTOES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTitulo(s)}
                    disabled={pending}
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                      titulo === s
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-200 text-neutral-600 hover:border-neutral-400'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Quando</Label>
              <div className="flex flex-wrap gap-1">
                {PRAZOS_RETORNO.map((p) => (
                  <button
                    key={p.valor}
                    type="button"
                    onClick={() => {
                      setPrazo(p.valor);
                      setDataManual('');
                    }}
                    disabled={pending}
                    className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                      prazo === p.valor && !dataManual
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-200 text-neutral-700 hover:border-neutral-400'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[11px] text-neutral-400">ou</span>
                <Input
                  type="date"
                  value={dataManual}
                  onChange={(e) => setDataManual(e.target.value)}
                  disabled={pending}
                  className="h-8 w-auto text-xs"
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={agendar} disabled={pending}>
            {pending ? <Spinner /> : <CalendarClock className="size-4" />}
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
