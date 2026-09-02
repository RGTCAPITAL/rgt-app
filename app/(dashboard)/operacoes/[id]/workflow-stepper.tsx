import { ETAPAS_FLUXO, indiceEtapa } from '@/lib/workflow';

export function WorkflowStepper({ etapaAtual }: { etapaAtual: string }) {
  const cancelada = etapaAtual === 'cancelada';
  const idxAtual = cancelada ? -1 : indiceEtapa(etapaAtual);

  return (
    <div className="rounded-md border border-neutral-200 bg-white p-4">
      {cancelada && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
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
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                      done
                        ? 'bg-emerald-600 text-white'
                        : active
                          ? 'bg-neutral-900 text-white ring-4 ring-neutral-900/10'
                          : 'bg-neutral-200 text-neutral-500'
                    }`}
                  >
                    {done ? '✓' : i + 1}
                  </div>
                  <span
                    className={`w-24 text-center text-xs leading-tight ${
                      active
                        ? 'font-semibold text-neutral-900'
                        : done
                          ? 'text-neutral-700'
                          : 'text-neutral-500'
                    }`}
                  >
                    {etapa.label}
                  </span>
                </div>
                {!isLast && (
                  <div
                    className={`mx-1 mt-4 h-0.5 flex-1 ${
                      done ? 'bg-emerald-600' : 'bg-neutral-200'
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
