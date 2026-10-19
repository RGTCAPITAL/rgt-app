'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RefreshCw, CheckCircle, AlertTriangle, Database, Clock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { avaliarFrescor, type NivelFrescor } from '@/lib/indices/frescor';
import { cn } from '@/lib/utils';
import { sincronizarIndices } from './actions';

export type ResumoSerie = {
  serie: string;
  label: string;
  usoNoCalculo: string;
  sgs: number;
  total: number;
  primeiraCompetencia: string | null;
  ultimaCompetencia: string | null;
  ultimoValor: number | null;
  temNumeroIndice: boolean;
  coletadoEm: string | null;
};

function fmtCompetencia(iso: string | null): string {
  if (!iso) return '—';
  const [ano, mes] = iso.split('-');
  const meses = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
  ];
  return `${meses[Number(mes) - 1]}/${ano}`;
}

/**
 * Aparencia de cada nivel de frescor.
 *
 * O selo tem uma obrigação: avisar ANTES de a precificação travar. O nível vem
 * de `avaliarFrescor`, que lê o MESMO `LIMITE_ATRASO_MESES` que
 * `obterFatorCorrecao` usa pra recusar — duplicar aquele número aqui faria a
 * tabela dizer "em dia" no dia em que a precificação começa a recusar.
 */
const ESTILO_FRESCOR: Record<NivelFrescor, { classe: string; Icone: typeof Clock }> = {
  ok: { classe: 'text-emerald-700', Icone: CheckCircle },
  atencao: { classe: 'text-amber-700', Icone: Clock },
  travado: { classe: 'font-medium text-red-700', Icone: ShieldAlert },
  vazia: { classe: 'text-neutral-400', Icone: Clock },
};

export function IndicesPainel({
  resumos,
  hojeIso,
}: {
  resumos: ResumoSerie[];
  /** Vem do servidor: o fuso do navegador discordaria na virada do mês. */
  hojeIso: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const vazias = resumos.filter((r) => r.total === 0);
  const totalPontos = resumos.reduce((s, r) => s + r.total, 0);

  function sincronizar() {
    startTransition(async () => {
      const res = await sincronizarIndices();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const comErro = res.resultados.filter((r) => r.erro);
      const gravados = res.resultados.reduce((s, r) => s + r.gravados, 0);

      if (comErro.length > 0) {
        toast.warning(`${gravados} pontos gravados · ${comErro.length} série(s) com erro`, {
          description: comErro.map((r) => `${r.serie}: ${r.erro}`).join(' · '),
          duration: 10000,
        });
      } else {
        toast.success(`${gravados} pontos sincronizados em ${res.resultados.length} séries`);
      }
      router.refresh();
    });
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <Database className="size-4" />
          {totalPontos.toLocaleString('pt-BR')} pontos armazenados
        </div>
        <Button onClick={sincronizar} disabled={pending} className="ml-auto">
          {pending ? (
            <>
              <Spinner size={3} />
              Sincronizando…
            </>
          ) : (
            <>
              <RefreshCw className="size-4" />
              Sincronizar com BCB/IBGE
            </>
          )}
        </Button>
      </div>

      {vazias.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <strong>
              {vazias.length} série{vazias.length === 1 ? '' : 's'} sem dados
            </strong>{' '}
            ({vazias.map((v) => v.label).join(', ')}). O cálculo de correção falha explicitamente
            enquanto faltar competência — nunca devolve fator parcial. Rode a sincronização.
          </div>
        </div>
      )}

      <AvisoTravamento resumos={resumos} hojeIso={hojeIso} />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Série</TableHead>
                <TableHead>Onde é usada</TableHead>
                <TableHead className="text-right">Pontos</TableHead>
                <TableHead>Cobertura</TableHead>
                <TableHead className="text-right">Última variação</TableHead>
                <TableHead>Nº índice</TableHead>
                <TableHead>Atualizada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resumos.map((r) => (
                <TableRow key={r.serie} className={r.total === 0 ? 'bg-amber-50/40' : ''}>
                  <TableCell>
                    <div className="font-medium text-neutral-900">{r.label}</div>
                    <div className="text-[11px] text-neutral-500">SGS {r.sgs}</div>
                  </TableCell>
                  <TableCell className="max-w-[320px] text-xs text-neutral-600">
                    {r.usoNoCalculo}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.total === 0 ? (
                      <span className="text-amber-700">0</span>
                    ) : (
                      r.total.toLocaleString('pt-BR')
                    )}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {r.total === 0 ? (
                      <span className="text-neutral-400">—</span>
                    ) : (
                      <>
                        {fmtCompetencia(r.primeiraCompetencia)} →{' '}
                        <strong>{fmtCompetencia(r.ultimaCompetencia)}</strong>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.ultimoValor === null ? (
                      <span className="text-neutral-400">—</span>
                    ) : (
                      <span className={r.ultimoValor < 0 ? 'text-red-600' : ''}>
                        {r.ultimoValor.toLocaleString('pt-BR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 4,
                        })}
                        %
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.temNumeroIndice ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle className="size-3" />
                        sim
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <SeloFrescor resumo={r} hojeIso={hojeIso} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <p className="mt-4 text-xs text-neutral-500">
        Sincronização automática todo dia às 12h (horário de Brasília), com carga completa nos dois
        primeiros dias do mês pra capturar revisão de valor antigo. O botão acima continua servindo
        pra forçar na hora.
      </p>

      <p className="mt-2 text-xs text-neutral-500">
        O mês em curso é sempre descartado: a série da Selic devolve o mês corrente ainda
        acumulando, e gravá-lo faria a correção sair a menor. Onde há número-índice (IPCA), o fator
        vira uma divisão só — encadear variações arredondadas acumula deriva em créditos antigos.
      </p>
    </>
  );
}

/**
 * "Coletado há N dias" e, mais importante, quando isso vira problema.
 *
 * O rótulo de tempo sozinho esconde o caso em que o cron roda todo dia mas a
 * FONTE parou de publicar: a coleta fica fresquíssima e a série, velha. O
 * nível olha a competência; o rótulo, a coleta.
 */
function SeloFrescor({ resumo, hojeIso }: { resumo: ResumoSerie; hojeIso: string }) {
  const f = avaliarFrescor(resumo.ultimaCompetencia, resumo.coletadoEm, hojeIso);
  const { classe, Icone } = ESTILO_FRESCOR[f.nivel];

  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs whitespace-nowrap', classe)}
      title={f.detalhe}
    >
      <Icone className="size-3 shrink-0" />
      {f.rotulo}
    </span>
  );
}

/**
 * O aviso que precisa estar acima da tabela, não dentro dela.
 *
 * Uma série travada faz a precificação RECUSAR o cálculo — e o erro aparece
 * numa tela de operação, longe daqui. Quem vê esse erro lá não tem como saber
 * que a causa é índice velho, então o aviso tem que estar onde dá pra agir.
 */
function AvisoTravamento({ resumos, hojeIso }: { resumos: ResumoSerie[]; hojeIso: string }) {
  const avaliadas = resumos
    .filter((r) => r.total > 0)
    .map((r) => ({ r, f: avaliarFrescor(r.ultimaCompetencia, r.coletadoEm, hojeIso) }));

  const travadas = avaliadas.filter((x) => x.f.nivel === 'travado');
  const emRisco = avaliadas.filter((x) => x.f.nivel === 'atencao');

  if (travadas.length === 0 && emRisco.length === 0) return null;

  const grave = travadas.length > 0;
  const alvo = grave ? travadas : emRisco;

  return (
    <div
      className={cn(
        'mb-4 flex items-start gap-2 rounded-md border p-3 text-sm',
        grave
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-amber-200 bg-amber-50 text-amber-900',
      )}
    >
      {grave ? (
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      ) : (
        <Clock className="mt-0.5 size-4 shrink-0" />
      )}
      <div>
        <strong>
          {grave
            ? `A precificação já recusa ${alvo.length === 1 ? 'uma série' : `${alvo.length} séries`}`
            : `${alvo.length === 1 ? 'Uma série' : `${alvo.length} séries`} no último mês antes de travar`}
        </strong>{' '}
        ({alvo.map((x) => x.r.label).join(', ')}). {alvo[0]!.f.detalhe}
      </div>
    </div>
  );
}
