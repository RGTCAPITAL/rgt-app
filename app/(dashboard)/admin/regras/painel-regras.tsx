'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { LIMITES, type ChaveRegra } from '@/lib/regras/decidir';
import { salvarRegra, type EntradaRegra } from './actions';

export type RegraVista = {
  chave: ChaveRegra;
  nome: string;
  /** O que a rotina faz de fato: parâmetro inválido conta como desligada. */
  ativa: boolean;
  valida: boolean;
  dias: number | null;
  maxTentativas: number | null;
  alteradaPor: string | null;
  alteradaEm: string;
};

const O_QUE_FAZ: Record<ChaveRegra, string> = {
  follow_up:
    'Lead na etapa Em contato, sem resposta no WhatsApp da RGT e sem tarefa aberta, ganha uma tarefa de follow-up para o dono: ligar ou mandar mensagem do próprio WhatsApp. Para quando a pessoa responde, quando o card muda de etapa ou depois do número máximo de tentativas.',
  lead_parado:
    'Lead que não avança ganha uma tarefa e um aviso no sino para o dono. Uma vez por etapa, no máximo 10 por pessoa por dia. Em Novo, só quem chegou sozinho (site, WhatsApp, indicação): importação em massa fica de fora, pra não virar enxurrada. Em Em contato, só depois que o follow-up termina ou a pessoa responde.',
  processo_andou:
    'Publicação nova no Diário de um processo acompanhado vira tarefa de leitura para o dono, com o número do processo e o link. Lead perdido por falta de ofício ganha a tarefa de conferir a cada nova citação de ofício requisitório no Diário; ele nunca é reaberto sozinho.',
};

const diaMesSP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
});

export function PainelRegras({ regras }: { regras: RegraVista[] }) {
  return (
    <div className="space-y-4">
      {regras.map((r) => (
        <CartaoRegra key={r.chave} regra={r} />
      ))}
    </div>
  );
}

/** Texto do input → inteiro dentro da faixa, ou null. */
function lerInteiro(v: string, faixa: { min: number; max: number }): number | null {
  if (!/^\d{1,3}$/.test(v.trim())) return null;
  const n = Number(v);
  return n >= faixa.min && n <= faixa.max ? n : null;
}

function CartaoRegra({ regra }: { regra: RegraVista }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // O interruptor muda na hora; se o servidor recusar, volta sozinho.
  const [ativa, setAtivaOtimista] = useOptimistic(regra.ativa);
  const [dias, setDias] = useState(String(regra.dias ?? ''));
  const [maxTentativas, setMaxTentativas] = useState(String(regra.maxTentativas ?? ''));

  const faixaDias = regra.chave === 'follow_up' ? LIMITES.followUpDias : LIMITES.leadParadoDias;
  const diasNum = lerInteiro(dias, faixaDias);
  const maxNum = lerInteiro(maxTentativas, LIMITES.followUpMaxTentativas);
  const temCampos = regra.chave !== 'processo_andou';
  const camposValidos =
    regra.chave === 'processo_andou' ||
    (diasNum !== null && (regra.chave !== 'follow_up' || maxNum !== null));
  const mudou =
    diasNum !== regra.dias || (regra.chave === 'follow_up' && maxNum !== regra.maxTentativas);

  /** Monta a entrada da action com o `ativa` e os números informados. */
  function entrada(novoAtiva: boolean, d: number | null, m: number | null): EntradaRegra {
    if (regra.chave === 'follow_up') {
      return { chave: 'follow_up', ativa: novoAtiva, dias: d ?? 0, maxTentativas: m ?? 0 };
    }
    if (regra.chave === 'lead_parado') {
      return { chave: 'lead_parado', ativa: novoAtiva, dias: d ?? 0 };
    }
    return { chave: 'processo_andou', ativa: novoAtiva };
  }

  // Ligar/desligar grava com os números JÁ SALVOS: o que está digitado e não
  // foi salvo continua esperando o botão Salvar.
  function alternar(novo: boolean) {
    startTransition(async () => {
      setAtivaOtimista(novo);
      const res = await salvarRegra(entrada(novo, regra.dias, regra.maxTentativas));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(novo ? `${regra.nome}: ligada` : `${regra.nome}: desligada`);
      router.refresh();
    });
  }

  function salvarNumeros() {
    if (!camposValidos) return;
    startTransition(async () => {
      const res = await salvarRegra(entrada(regra.ativa, diasNum, maxNum));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Regra salva');
      router.refresh();
    });
  }

  const idBase = `regra-${regra.chave}`;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-60">
            <div className="text-sm font-semibold text-neutral-900">{regra.nome}</div>
            <p className="mt-1 text-xs break-words text-neutral-600">{O_QUE_FAZ[regra.chave]}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Selo neutro: desligada é o estado normal, não um alerta. */}
            <span
              className={
                ativa
                  ? 'rounded bg-neutral-900 px-1.5 py-0.5 text-[11px] font-medium text-white'
                  : 'rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600'
              }
            >
              {ativa ? 'Ligada' : 'Desligada'}
            </span>
            <Switch
              checked={ativa}
              onCheckedChange={alternar}
              disabled={pending}
              aria-label={`Ligar ${regra.nome}`}
            />
          </div>
        </div>

        {!regra.valida && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Os números desta regra no banco não fecham, então ela está sendo tratada como desligada.
            Salve os números abaixo para corrigir.
          </p>
        )}

        {temCampos && (
          <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
            <div
              className={`flex min-w-0 flex-col gap-1.5 ${regra.chave === 'lead_parado' ? 'col-span-2 sm:col-span-1' : ''}`}
            >
              <Label htmlFor={`${idBase}-dias`}>
                {regra.chave === 'follow_up' ? 'Esperar quantos dias' : 'Dias sem mudar de etapa'}
              </Label>
              <Input
                id={`${idBase}-dias`}
                type="number"
                inputMode="numeric"
                min={faixaDias.min}
                max={faixaDias.max}
                value={dias}
                onChange={(e) => setDias(e.target.value)}
                disabled={pending}
                aria-invalid={diasNum === null}
                className="max-w-32 sm:w-28"
              />
              <span className="text-[11px] text-neutral-500">
                de {faixaDias.min} a {faixaDias.max}
              </span>
            </div>
            {regra.chave === 'follow_up' && (
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={`${idBase}-max`}>Máx. de tentativas</Label>
                <Input
                  id={`${idBase}-max`}
                  type="number"
                  inputMode="numeric"
                  min={LIMITES.followUpMaxTentativas.min}
                  max={LIMITES.followUpMaxTentativas.max}
                  value={maxTentativas}
                  onChange={(e) => setMaxTentativas(e.target.value)}
                  disabled={pending}
                  aria-invalid={maxNum === null}
                  className="max-w-32 sm:w-28"
                />
                <span className="text-[11px] text-neutral-500">
                  de {LIMITES.followUpMaxTentativas.min} a {LIMITES.followUpMaxTentativas.max}
                </span>
              </div>
            )}
            <Button
              onClick={salvarNumeros}
              disabled={pending || !camposValidos || (!mudou && regra.valida)}
              className="col-span-2 w-full sm:mb-[22px] sm:w-auto"
            >
              {pending ? <Spinner /> : <Check className="size-3.5" />}
              Salvar
            </Button>
          </div>
        )}

        <p className="text-[11px] text-neutral-500">
          {regra.alteradaPor
            ? `Alterada por ${regra.alteradaPor} em ${diaMesSP.format(new Date(regra.alteradaEm))}`
            : 'Ainda não alterada por ninguém'}
        </p>
      </CardContent>
    </Card>
  );
}
