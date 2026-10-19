'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { salvarPrecoProposto } from './actions';

/**
 * Preço proposto ao cedente.
 *
 * Salva sem declarar aceite — que era impossível até agora. O percentual do
 * líquido aparece enquanto se digita, porque é por ele que se decide se o
 * número faz sentido: "R$ 790 mil" não diz nada sozinho, "71% do líquido" diz.
 */

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Aceita "790.000,00", "790000", "R$ 790.000" — como a pessoa digitar. */
function parseValor(txt: string): number | null {
  const limpo = txt.replace(/[R$\s.]/g, '').replace(',', '.');
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function CampoPreco({
  operacaoId,
  precoAtual,
  justificativaAtual,
  liquido,
  precoAceito,
  definidoEm,
  definidoPor,
  podeEditar,
}: {
  operacaoId: string;
  precoAtual: number | null;
  justificativaAtual: string | null;
  liquido: number | null;
  precoAceito: boolean | null;
  definidoEm: string | null;
  definidoPor: string | null;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(
    precoAtual !== null ? precoAtual.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '',
  );
  const [justificativa, setJustificativa] = useState(justificativaAtual ?? '');
  const [pending, startTransition] = useTransition();

  const valorDigitado = parseValor(texto);
  const pctDigitado =
    valorDigitado !== null && liquido !== null && liquido > 0
      ? (valorDigitado / liquido) * 100
      : null;

  // Acima do líquido a RGT pagaria mais do que o crédito vale. Não é
  // proibido — pode haver razão comercial —, mas tem que gritar.
  const acimaDoLiquido = pctDigitado !== null && pctDigitado > 100;

  function salvar() {
    if (texto.trim() && valorDigitado === null) {
      toast.error('Não entendi esse valor. Use algo como 790.000,00');
      return;
    }
    startTransition(async () => {
      const res = await salvarPrecoProposto(operacaoId, valorDigitado, justificativa || null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(valorDigitado === null ? 'Preço removido' : 'Preço salvo');
      setEditando(false);
      router.refresh();
    });
  }

  function cancelar() {
    setTexto(
      precoAtual !== null ? precoAtual.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '',
    );
    setJustificativa(justificativaAtual ?? '');
    setEditando(false);
  }

  if (!editando) {
    const pctAtual =
      precoAtual !== null && liquido !== null && liquido > 0 ? (precoAtual / liquido) * 100 : null;

    return (
      <div className="rounded-lg border border-neutral-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-neutral-900">Preço proposto ao cedente</div>
            {precoAtual === null ? (
              <p className="mt-1 text-xs text-neutral-500">
                Nenhum preço definido. O cálculo automático do deságio ainda não está configurado —
                por enquanto o valor é definido aqui.
              </p>
            ) : (
              <div className="mt-1 space-y-0.5 text-xs text-neutral-500">
                {definidoEm && (
                  <div>
                    definido em {new Date(definidoEm).toLocaleDateString('pt-BR')}
                    {definidoPor ? ` por ${definidoPor}` : ''}
                  </div>
                )}
                {justificativaAtual && <div className="text-neutral-600">{justificativaAtual}</div>}
                {precoAceito === true && (
                  <div className="font-medium text-emerald-700">aceito pelo credor</div>
                )}
                {precoAceito === false && (
                  <div className="font-medium text-red-700">recusado pelo credor</div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-lg font-semibold text-neutral-900 tabular-nums">
                {precoAtual !== null ? fmtBRL(precoAtual) : '—'}
              </div>
              {pctAtual !== null && (
                <div className="text-[11px] text-neutral-500">
                  {pctAtual.toFixed(2)}% do líquido
                </div>
              )}
            </div>
            {podeEditar && precoAceito !== true && (
              <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
                <Pencil className="size-3.5" />
                {precoAtual === null ? 'Definir' : 'Alterar'}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-4">
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preco">Preço ao cedente</Label>
            <Input
              id="preco"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="790.000,00"
              disabled={pending}
              autoFocus
              className="tabular-nums"
            />
            {pctDigitado !== null && (
              <span
                className={`text-[11px] ${acimaDoLiquido ? 'font-medium text-red-600' : 'text-neutral-500'}`}
              >
                {pctDigitado.toFixed(2)}% do líquido
                {acimaDoLiquido && ' — acima do crédito disponível'}
              </span>
            )}
            {liquido === null && (
              <span className="text-[11px] text-amber-700">
                o líquido não pôde ser calculado, então não dá pra conferir o percentual
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="justificativa">Por que esse preço (opcional)</Label>
            <Textarea
              id="justificativa"
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Ex: ente com histórico de atraso, credor com urgência, negociado por telefone"
              rows={2}
              disabled={pending}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-neutral-500">
            Salvar aqui não registra aceite do credor. A resposta dele é registrada na etapa de
            Aceite.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={cancelar} disabled={pending}>
              <X className="size-3.5" />
              Cancelar
            </Button>
            <Button size="sm" onClick={salvar} disabled={pending}>
              {pending ? <Spinner /> : <Check className="size-3.5" />}
              Salvar preço
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
