'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Check, Pencil, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import {
  fmtPercentual,
  fmtVigencia,
  type BaseDesagio,
  type PrecoSugerido,
  type SituacaoProposta,
} from '@/lib/precificacao/desagio';
import { salvarPrecoProposto } from './actions';

/**
 * Preço proposto ao cedente.
 *
 * Salva sem declarar aceite — que era impossível até agora. O percentual do
 * líquido aparece enquanto se digita, porque é por ele que se decide se o
 * número faz sentido: "R$ 790 mil" não diz nada sozinho, "71% do líquido" diz.
 */

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** "face" aqui é o bruto corrigido até hoje — escrito por extenso pra não haver dúvida. */
const rotuloBase = (b: BaseDesagio) =>
  b === 'face' ? 'valor de face atualizado' : 'líquido cedível';

/** "+R$ 12.000,00 (+3,6%)" — o tamanho da divergência em relação ao sugerido. */
function fmtDelta(valor: number, sugerido: number): string {
  const d = valor - sugerido;
  const sinal = d > 0 ? '+' : d < 0 ? '−' : '';
  const pct = sugerido > 0 ? Math.abs((d / sugerido) * 100) : 0;
  return `${sinal}${fmtBRL(Math.abs(d))} (${sinal}${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)`;
}

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
  loa,
  desagio,
}: {
  operacaoId: string;
  precoAtual: number | null;
  justificativaAtual: string | null;
  liquido: number | null;
  precoAceito: boolean | null;
  definidoEm: string | null;
  definidoPor: string | null;
  podeEditar: boolean;
  loa: number | null;
  desagio: { situacao: SituacaoProposta; sugestao: PrecoSugerido | null };
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

  const sugerido = desagio.sugestao?.ok ? desagio.sugestao : null;
  // O fator só vai junto quando o valor salvo É o sugerido. Se ele mexeu no
  // número, o preço é dele, e dizer que veio do percentual seria mentira.
  const fatorParaSalvar =
    sugerido && valorDigitado !== null && Math.abs(valorDigitado - sugerido.preco) < 0.005
      ? sugerido.fator.id
      : null;

  function usarSugerido() {
    if (!sugerido) return;
    setTexto(sugerido.preco.toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
  }

  function salvar() {
    if (texto.trim() && valorDigitado === null) {
      toast.error('Não entendi esse valor. Use algo como 790.000,00');
      return;
    }
    startTransition(async () => {
      const res = await salvarPrecoProposto(
        operacaoId,
        valorDigitado,
        justificativa || null,
        fatorParaSalvar,
      );
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
      <div className="space-y-3">
        <Sugestao desagio={desagio} loa={loa} precoAtual={precoAtual} podeEditar={podeEditar} />
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-neutral-900">Preço proposto ao cedente</div>
              {precoAtual === null ? (
                <p className="mt-1 text-xs text-neutral-500">Nenhum preço definido ainda.</p>
              ) : (
                <div className="mt-1 space-y-0.5 text-xs text-neutral-500">
                  {definidoEm && (
                    <div>
                      definido em {new Date(definidoEm).toLocaleDateString('pt-BR')}
                      {definidoPor ? ` por ${definidoPor}` : ''}
                    </div>
                  )}
                  {justificativaAtual && (
                    <div className="text-neutral-600">{justificativaAtual}</div>
                  )}
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
            {sugerido && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={usarSugerido}
                disabled={pending}
                className="h-auto justify-start py-1.5 text-left whitespace-normal"
              >
                <Sparkles className="size-3.5 shrink-0" />
                Usar o sugerido ({fmtBRL(sugerido.preco)})
              </Button>
            )}
            {sugerido && valorDigitado !== null && fatorParaSalvar === null && (
              <span className="text-[11px] text-amber-700">
                {fmtDelta(valorDigitado, sugerido.preco)} em relação ao sugerido — vale explicar ao
                lado
              </span>
            )}
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

/**
 * O que o percentual da LOA diz sobre esta operação.
 *
 * Cada situação sem preço possível é nomeada em vez de virar um número
 * plausível: sem LOA, sem percentual cadastrado, sem líquido calculável.
 */
function Sugestao({
  desagio,
  loa,
  precoAtual,
  podeEditar,
}: {
  desagio: { situacao: SituacaoProposta; sugestao: PrecoSugerido | null };
  loa: number | null;
  precoAtual: number | null;
  podeEditar: boolean;
}) {
  const { situacao, sugestao } = desagio;

  if (situacao.situacao === 'sem_loa') {
    return (
      <p className="text-xs text-neutral-500">
        A operação não tem LOA preenchida, então não há percentual para sugerir o preço.
      </p>
    );
  }

  if (situacao.situacao === 'sem_fator') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>
          O percentual de aquisição da LOA {situacao.loaAno} ainda não foi cadastrado, então não há
          preço sugerido.{' '}
          {podeEditar && (
            <Link href="/admin/desagio" className="font-medium underline">
              Cadastrar percentual
            </Link>
          )}
        </span>
      </div>
    );
  }

  if (!sugestao) return null;

  if (!sugestao.ok) {
    return (
      <p className="text-xs text-amber-700">
        A LOA {loa} está em {fmtPercentual(sugestao.fator.percentual)} sobre o{' '}
        {rotuloBase(sugestao.fator.base)}, mas esse valor não pôde ser calculado. Veja as pendências
        acima.
      </p>
    );
  }

  const origem = (
    <>
      {fmtPercentual(sugestao.fator.percentual)} sobre o {rotuloBase(sugestao.fator.base)} (
      {fmtBRL(sugestao.valorBase)}), vigente desde {fmtVigencia(sugestao.fator.vigenteDesde)}
      {sugestao.percentualAquisicao !== 100 &&
        ` · compra de ${fmtPercentual(sugestao.percentualAquisicao)} do crédito`}
    </>
  );

  return (
    <div className="space-y-2">
      {situacao.situacao === 'desatualizada' && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong>Proposta desatualizada.</strong> Foi feita com{' '}
            {fmtPercentual(situacao.usado.percentual)} ({fmtVigencia(situacao.usado.vigenteDesde)}
            ). Hoje a LOA {loa} está em {fmtPercentual(situacao.atual.percentual)} (
            {situacao.variacaoPontos > 0 ? '+' : ''}
            {situacao.variacaoPontos.toLocaleString('pt-BR')} p.p.). O novo preço sugerido está
            abaixo.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
        <div className="text-xs text-neutral-600">
          <div className="text-sm font-medium text-neutral-900">Preço sugerido</div>
          <div>{origem}</div>
          {sugestao.provisorio && (
            <div className="mt-0.5 font-medium text-amber-700">
              estimativa: o líquido ainda é provisório
            </div>
          )}
          {situacao.situacao === 'em_dia' && (
            <div className="mt-0.5 text-emerald-700">a proposta usa este percentual</div>
          )}
          {situacao.situacao === 'origem_desconhecida' && precoAtual !== null && (
            <div className="mt-0.5">
              a proposta foi definida à mão: {fmtDelta(precoAtual, sugestao.preco)} em relação ao
              sugerido
            </div>
          )}
        </div>
        <div className="text-lg font-semibold text-emerald-900 tabular-nums">
          {fmtBRL(sugestao.preco)}
        </div>
      </div>
    </div>
  );
}
