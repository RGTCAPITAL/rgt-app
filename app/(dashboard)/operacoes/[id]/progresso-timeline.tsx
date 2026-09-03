import { Check, Circle, XCircle } from 'lucide-react';
import { ETAPAS_FLUXO, indiceEtapa } from '@/lib/workflow';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type EtapaHist = {
  etapa: string;
  entrou_em: string;
  saiu_em: string | null;
};

function fmtDataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
}

function diffDias(inicio: string, fim: string | null): string {
  const start = new Date(inicio).getTime();
  const end = fim ? new Date(fim).getTime() : Date.now();
  const dias = Math.floor((end - start) / 86400000);
  if (dias === 0) return '<1d';
  return `${dias}d`;
}

/**
 * Timeline vertical de progresso na sidebar (padrão Lajedo).
 * Mostra todas as 8 etapas do workflow + status/data/duração.
 */
export function ProgressoTimeline({
  etapaAtual,
  historico,
}: {
  etapaAtual: string;
  historico: EtapaHist[];
}) {
  const cancelada = etapaAtual === 'cancelada';
  const idxAtual = cancelada ? -1 : indiceEtapa(etapaAtual);

  // Cria um map: etapa -> { entrou_em, saiu_em }
  const histMap = new Map<string, { entrou_em: string; saiu_em: string | null }>();
  for (const h of historico) {
    if (!histMap.has(h.etapa)) {
      histMap.set(h.etapa, { entrou_em: h.entrou_em, saiu_em: h.saiu_em });
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Progresso</CardTitle>
      </CardHeader>
      <CardContent>
        {cancelada && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <XCircle className="size-4 shrink-0" />
            Operação cancelada
          </div>
        )}
        <ol className="space-y-4">
          {ETAPAS_FLUXO.map((etapa, i) => {
            const done = !cancelada && i < idxAtual;
            const active = !cancelada && i === idxAtual;
            const hist = histMap.get(etapa.value);
            const isLast = i === ETAPAS_FLUXO.length - 1;

            return (
              <li key={etapa.value} className="relative flex gap-3">
                {!isLast && (
                  <div
                    className={cn(
                      'absolute top-4 left-[7px] h-full w-px',
                      done ? 'bg-emerald-500' : 'bg-neutral-200',
                    )}
                    aria-hidden
                  />
                )}
                <div className="relative z-10 flex shrink-0 flex-col items-center">
                  {done ? (
                    <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check className="size-2.5" strokeWidth={3} />
                    </span>
                  ) : active ? (
                    <span className="bg-primary ring-primary/20 flex size-4 items-center justify-center rounded-full ring-4">
                      <Circle className="size-1.5 fill-white text-white" />
                    </span>
                  ) : (
                    <span className="flex size-4 items-center justify-center rounded-full bg-neutral-200">
                      <Circle className="size-1.5 fill-neutral-400 text-neutral-400" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div
                    className={cn(
                      'text-xs leading-tight font-medium',
                      active && 'text-primary',
                      done && 'text-neutral-900',
                      !active && !done && 'text-neutral-500',
                    )}
                  >
                    {etapa.label}
                    {active && (
                      <span className="text-primary ml-1.5 text-[10px] font-normal">
                        · em andamento
                      </span>
                    )}
                  </div>
                  {hist && (
                    <div className="mt-0.5 text-[10px] text-neutral-500">
                      {fmtDataCurta(hist.entrou_em)}
                      {hist.saiu_em ? ` → ${fmtDataCurta(hist.saiu_em)}` : ''}
                      {' · '}
                      {diffDias(hist.entrou_em, hist.saiu_em)}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
