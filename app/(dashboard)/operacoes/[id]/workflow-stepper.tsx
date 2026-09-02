import { Check, XCircle } from 'lucide-react';
import { ETAPAS_FLUXO, indiceEtapa } from '@/lib/workflow';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function WorkflowStepper({ etapaAtual }: { etapaAtual: string }) {
  const cancelada = etapaAtual === 'cancelada';
  const idxAtual = cancelada ? -1 : indiceEtapa(etapaAtual);

  return (
    <Card>
      <CardContent>
        {cancelada && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <XCircle className="size-4 shrink-0" />
            Operação cancelada — o workflow foi interrompido.
          </div>
        )}

        <div className="overflow-x-auto">
          <ol className="flex min-w-max items-start gap-0">
            {ETAPAS_FLUXO.map((etapa, i) => {
              const done = !cancelada && i < idxAtual;
              const active = !cancelada && i === idxAtual;
              const isLast = i === ETAPAS_FLUXO.length - 1;

              return (
                <li key={etapa.value} className="flex flex-1 items-start">
                  <div className="flex flex-col items-center gap-2">
                    <div
                      className={cn(
                        'flex size-9 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                        done && 'bg-emerald-600 text-white',
                        active && 'bg-neutral-900 text-white ring-4 ring-neutral-900/10',
                        !done && !active && 'bg-neutral-200 text-neutral-500',
                      )}
                    >
                      {done ? <Check className="size-4" strokeWidth={2.5} /> : i + 1}
                    </div>
                    <span
                      className={cn(
                        'w-24 text-center text-xs leading-tight',
                        active && 'font-semibold text-neutral-900',
                        done && 'text-neutral-700',
                        !done && !active && 'text-neutral-500',
                      )}
                    >
                      {etapa.label}
                    </span>
                  </div>
                  {!isLast && (
                    <div
                      className={cn(
                        'mx-1 mt-4 h-0.5 flex-1 transition-colors',
                        done ? 'bg-emerald-600' : 'bg-neutral-200',
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
