'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle, RefreshCw, Search, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { rodarConsultaJudit } from './judit-actions';
import { RED_FLAG_LABEL, type RedFlag } from '@/lib/judit/types';
import { fmtDataBR } from '@/lib/formatters';

type Props = {
  operacaoId: string;
  numeroProcesso: string;
  atualizadoEm: string | null;
  redFlags: RedFlag[];
  juditConfigurada: boolean;
};

function fmtRel(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias} dias`;
}

export function JuditCard({
  operacaoId,
  numeroProcesso,
  atualizadoEm,
  redFlags,
  juditConfigurada,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [ultimasFlags, setUltimasFlags] = useState<RedFlag[]>(redFlags);
  const [ultimaConsulta, setUltimaConsulta] = useState<string | null>(atualizadoEm);

  function rodar() {
    startTransition(async () => {
      const res = await rodarConsultaJudit(operacaoId);
      if (!res.ok) {
        toast.error(res.erro);
        return;
      }
      setUltimasFlags(res.redFlags);
      setUltimaConsulta(new Date().toISOString());
      toast.success(
        res.redFlags.length === 0
          ? 'Consulta Judit OK · nenhum red flag'
          : `Consulta Judit OK · ${res.redFlags.length} red flag${res.redFlags.length === 1 ? '' : 's'}`,
      );
    });
  }

  if (!juditConfigurada) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Search className="size-4 text-blue-600" />
            Consulta Judit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="size-4 shrink-0" />
            <div>
              Integração Judit ainda não configurada. Adicione{' '}
              <code className="rounded bg-amber-100 px-1">JUDIT_API_KEY</code> no{' '}
              <code>.env.local</code> pra habilitar consulta automática de processos.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const semConsulta = !ultimaConsulta;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-sm font-semibold">
          <span className="flex items-center gap-2">
            <Search className="size-4 text-blue-600" />
            Consulta Judit
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={rodar}
            disabled={pending}
            className="text-xs"
          >
            {pending ? (
              <>
                <Spinner size={3} />
                Consultando…
              </>
            ) : (
              <>
                <RefreshCw className="size-3" />
                {semConsulta ? 'Rodar consulta' : 'Atualizar dados'}
              </>
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {semConsulta ? (
          <p className="text-sm text-neutral-600">
            Nenhuma consulta feita ainda pro processo{' '}
            <code className="rounded bg-neutral-100 px-1 font-mono text-xs">{numeroProcesso}</code>.
            Clique em <strong>Rodar consulta</strong> pra trazer dados do CNJ automaticamente
            (partes, movimentações, penhoras, status).
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <CheckCircle className="size-3.5 text-emerald-600" />
              Última consulta{' '}
              <span className="font-medium text-neutral-900">{fmtRel(ultimaConsulta!)}</span> ·{' '}
              {fmtDataBR(ultimaConsulta!)}
            </div>

            {ultimasFlags.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle className="size-4 shrink-0" />
                Nenhum red flag detectado no processo.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-medium text-neutral-700">
                  {ultimasFlags.length} red flag{ultimasFlags.length === 1 ? '' : 's'} detectado
                  {ultimasFlags.length === 1 ? '' : 's'}
                </div>
                <ul className="space-y-1.5">
                  {ultimasFlags.map((flag) => (
                    <li
                      key={flag}
                      className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800"
                    >
                      <XCircle className="size-3.5 shrink-0" />
                      <span>{RED_FLAG_LABEL[flag] ?? flag}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-neutral-500">
                  Robson valida cada red flag e decide se avança pra próxima etapa.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
