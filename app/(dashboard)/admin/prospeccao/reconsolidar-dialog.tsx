'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { mascararCnj } from '@/lib/djen/mappers';
import type { CampoDiff, LinhaDiff, ResumoDiff } from '@/lib/prospeccao/reconsolidar';
import { reconsolidarProspeccaoDjen } from './reconsolidar-action';

type Simulacao = { diffs: LinhaDiff[]; hash: string; resumo: ResumoDiff };

const CAMPO_LABEL: Record<CampoDiff, string> = {
  credor: 'Credor',
  advogado: 'Advogado',
  red_flags: 'Red flags',
};

function fmtBRL(v: number | null): string {
  if (v === null) return '—';
  return Number(v).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function textoResumo(r: ResumoDiff): string {
  return [
    plural(r.credorCorrigir, 'credor a corrigir', 'credores a corrigir'),
    `${plural(r.credorRevisar, 'credor pra revisar', 'credores pra revisar')} (não ${r.credorRevisar === 1 ? 'muda' : 'mudam'})`,
    // Sem o "a corrigir", "77 advogados" não dizia se eram os que mudam ou o total.
    plural(r.advogado, 'advogado a corrigir', 'advogados a corrigir') +
      (r.advogadoRevisar > 0 ? ` (+${r.advogadoRevisar} pra revisar)` : ''),
    plural(r.redFlags, 'processo com red flag diferente', 'processos com red flag diferente'),
  ].join(' · ');
}

/** Valor vazio aparece escrito, pra "antes → depois" nunca ficar com um lado em branco. */
function Valor({
  campo,
  valor,
  forte,
}: {
  campo: CampoDiff;
  valor: string | null;
  forte?: boolean;
}) {
  if (valor === null) {
    return (
      <span className="text-neutral-400 italic">{campo === 'red_flags' ? 'nenhuma' : 'vazio'}</span>
    );
  }
  return (
    <span className={forte ? 'font-medium text-neutral-900' : 'text-neutral-500'}>{valor}</span>
  );
}

/**
 * Botão + diálogo "Recalcular credores" da fila de prospecção.
 *
 * Abre já simulando: lê as publicações do DJEN guardadas, recalcula credor,
 * advogado e red flags e mostra o que mudaria. Só grava quando o admin clica
 * em aplicar, e a action recusa se o diff mudou desde a simulação (o hash vai
 * junto). Os itens "revisar" aparecem pra conferência mas nunca são gravados.
 *
 * Sem props: a action decide tudo no servidor e exige perfil admin — quem
 * monta o botão só precisa escondê-lo de quem não é admin.
 */
export function ReconsolidarDialog() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [simulando, startSimulacao] = useTransition();
  const [aplicando, startAplicacao] = useTransition();
  // Fechar e reabrir no meio de uma simulação dispara outra; só a última vale.
  const rodada = useRef(0);

  function simular() {
    const minha = ++rodada.current;
    setSimulacao(null);
    setErro(null);
    startSimulacao(async () => {
      const res = await reconsolidarProspeccaoDjen({ aplicar: false });
      if (minha !== rodada.current) return;
      if (!res.ok) {
        setErro(res.error);
        return;
      }
      if (res.aplicado) return;
      setSimulacao({ diffs: res.diffs, hash: res.hash, resumo: res.resumo });
    });
  }

  function abrir() {
    setAberto(true);
    simular();
  }

  function fechar() {
    if (aplicando) return;
    rodada.current++;
    setAberto(false);
  }

  const correcoes = simulacao?.diffs.filter((d) => d.tipo === 'corrigir').length ?? 0;

  function aplicar() {
    if (!simulacao || correcoes === 0) return;
    const { hash } = simulacao;
    startAplicacao(async () => {
      const res = await reconsolidarProspeccaoDjen({ aplicar: true, hashEsperado: hash });
      if (!res.ok) {
        // Hash diferente cai aqui: some a tabela velha pra ninguém aplicar
        // em cima dela, e o botão "Simular de novo" aparece.
        setSimulacao(null);
        setErro(res.error);
        return;
      }
      if (!res.aplicado) return;

      const texto = `${plural(res.atualizadas, 'processo atualizado', 'processos atualizados')} de ${res.esperadas}.`;
      if (res.falhas.length > 0) {
        toast.error(
          `${texto} ${plural(res.falhas.length, 'falhou', 'falharam')}: ${res.falhas[0]}`,
        );
      } else if (res.atualizadas < res.esperadas) {
        toast.warning(
          `${texto} Os outros mudaram de status no meio do caminho e ficaram como estavam.`,
        );
      } else {
        toast.success(texto);
      }
      setAberto(false);
      setSimulacao(null);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" onClick={abrir}>
        <RefreshCw className="size-4" />
        Recalcular credores
      </Button>

      <Dialog
        open={aberto}
        onOpenChange={(abrirAgora) => (abrirAgora ? setAberto(true) : fechar())}
      >
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="size-5 text-neutral-700" />
              Recalcular credores
            </DialogTitle>
            <DialogDescription>
              Refaz credor, advogado e red flags dos processos enriquecidos usando as publicações do
              DJEN já salvas. Nada muda até você clicar em aplicar.
            </DialogDescription>
          </DialogHeader>

          {simulando && (
            <div className="flex items-center gap-2 py-8 text-sm text-neutral-600">
              <Spinner size={4} />
              Lendo as publicações e recalculando…
            </div>
          )}

          {!simulando && erro && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <span>{erro}</span>
              <Button variant="outline" size="sm" onClick={simular} disabled={aplicando}>
                <RefreshCw className="size-3.5" />
                Simular de novo
              </Button>
            </div>
          )}

          {!simulando && simulacao && (
            <div className="grid gap-3">
              <p className="text-sm text-neutral-800">{textoResumo(simulacao.resumo)}</p>

              {simulacao.diffs.length === 0 ? (
                <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
                  Nada a mudar: a fila já bate com o recálculo.
                </p>
              ) : (
                <div className="max-h-[55vh] overflow-auto rounded-md border border-neutral-200">
                  <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-neutral-50 text-neutral-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Processo</th>
                        <th className="px-3 py-2 font-medium">Campo</th>
                        <th className="px-3 py-2 font-medium">Antes → depois</th>
                        <th className="px-3 py-2 font-medium">Tipo</th>
                        <th className="px-3 py-2 font-medium">Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {simulacao.diffs.map((d) => (
                        <tr
                          key={`${d.id}-${d.campo}`}
                          className="border-t border-neutral-100 align-top"
                        >
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="font-mono text-[11px] text-neutral-900">
                              {mascararCnj(d.numero_processo)}
                            </div>
                            <div className="text-neutral-500">{fmtBRL(d.valor_face)}</div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-neutral-700">
                            {CAMPO_LABEL[d.campo]}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Valor campo={d.campo} valor={d.antes} />
                              <ArrowRight
                                className="size-3 shrink-0 text-neutral-400"
                                aria-label="vira"
                              />
                              <Valor campo={d.campo} valor={d.depois} forte />
                            </div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {d.tipo === 'revisar' ? (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                revisar — não muda
                              </span>
                            ) : (
                              <span className="rounded-full border border-neutral-300 bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-700">
                                corrigir
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-neutral-600">{d.motivo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {simulacao.diffs.some((d) => d.tipo === 'revisar') && (
                <p className="text-[11px] text-neutral-500">
                  Os itens &quot;revisar&quot; ficam como estão. Confira no processo e corrija à mão
                  se for o caso.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={fechar} disabled={aplicando}>
              Cancelar
            </Button>
            <Button
              onClick={aplicar}
              disabled={!simulacao || correcoes === 0 || simulando || aplicando}
            >
              {aplicando ? (
                <>
                  <Spinner size={3} />
                  Aplicando…
                </>
              ) : (
                <>Aplicar {plural(correcoes, 'correção', 'correções')}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
