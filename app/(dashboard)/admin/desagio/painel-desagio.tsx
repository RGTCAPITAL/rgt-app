'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, History, Plus, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  fatorVigente,
  fmtPercentual,
  fmtVigencia,
  ROTULO_BASE,
  type BaseDesagio,
  type FatorLoa,
} from '@/lib/precificacao/desagio';
import { salvarFator } from './actions';

export type LoaEmUso = { ano: number; operacoes: number; operacoesReais: number };

export function PainelDesagio({
  fatores,
  loasEmUso,
  hojeIso,
}: {
  fatores: FatorLoa[];
  loasEmUso: LoaEmUso[];
  /** Vem do servidor — o fuso do navegador discordaria na virada do dia. */
  hojeIso: string;
}) {
  const router = useRouter();
  const [abertoPara, setAbertoPara] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  // LOA que ainda não tem operação nem percentual. Sem isto, as LOAs 2025–2028
  // só apareciam por causa das operações de exemplo, e 2029 não tinha como ser
  // cadastrada antes de chegar a primeira operação dela (RGT-96).
  const [anosExtras, setAnosExtras] = useState<number[]>([]);
  const [novoAno, setNovoAno] = useState('');

  // Todo ano que tem operação, todo ano que já tem percentual, e os que ele abriu à mão.
  const anos = [
    ...new Set([...loasEmUso.map((l) => l.ano), ...fatores.map((f) => f.loaAno), ...anosExtras]),
  ].sort((a, b) => a - b);

  const novoAnoNum = Number(novoAno);
  const novoAnoValido = Number.isInteger(novoAnoNum) && novoAnoNum >= 2020 && novoAnoNum <= 2100;

  function abrirOutraLoa() {
    if (!novoAnoValido) return;
    if (!anos.includes(novoAnoNum)) setAnosExtras((a) => [...a, novoAnoNum]);
    setAbertoPara(novoAnoNum);
    setNovoAno('');
  }

  const semPercentual = anos.filter((a) => !fatorVigente(fatores, a, hojeIso));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-xs text-neutral-600">
        <div className="mb-1 font-medium text-neutral-900">Como isto é usado</div>
        <p>
          A tela de precificação aplica o percentual do ano de LOA da operação para sugerir um
          preço. Quando o percentual muda, as propostas já feitas <strong>não</strong> mudam junto —
          elas continuam explicadas pelo percentual que estava valendo no dia, e a operação passa a
          mostrar que ficou desatualizada.
        </p>
      </div>

      {semPercentual.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <strong>
              {semPercentual.length === 1
                ? 'Uma LOA sem percentual'
                : `${semPercentual.length} LOAs sem percentual`}
            </strong>{' '}
            ({semPercentual.join(', ')}). A precificação dessas operações não consegue sugerir preço
            enquanto o percentual não for cadastrado — ela mostra &quot;não cadastrado&quot; em vez
            de chutar um número.
          </div>
        </div>
      )}

      {anos.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-neutral-500">
            Nenhuma operação com LOA preenchida ainda, e nenhum percentual cadastrado.
          </CardContent>
        </Card>
      )}

      {anos.map((ano) => {
        const vigente = fatorVigente(fatores, ano, hojeIso);
        const historico = fatores
          .filter((f) => f.loaAno === ano)
          .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
        const futuros = historico.filter((f) => f.vigenteDesde > hojeIso);
        const passados = historico.filter((f) => vigente && f.vigenteDesde < vigente.vigenteDesde);
        const uso = loasEmUso.find((l) => l.ano === ano);

        return (
          <Card key={ano}>
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-neutral-900">LOA {ano}</span>
                    {uso && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                        {uso.operacoes} {uso.operacoes === 1 ? 'operação' : 'operações'}
                        {uso.operacoesReais === 0 && uso.operacoes > 0 && ' · só exemplos'}
                      </span>
                    )}
                  </div>

                  {vigente ? (
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                      <span className="text-2xl font-semibold text-neutral-900 tabular-nums">
                        {fmtPercentual(vigente.percentual)}
                      </span>
                      <span className="text-xs text-neutral-600">
                        sobre o <strong>{ROTULO_BASE[vigente.base]}</strong>, desde{' '}
                        {fmtVigencia(vigente.vigenteDesde)}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-1.5 text-sm text-amber-700">Percentual não cadastrado.</div>
                  )}

                  {vigente?.observacao && (
                    <p className="mt-1 border-l-2 border-neutral-200 pl-2 text-xs text-neutral-500 italic">
                      {vigente.observacao}
                    </p>
                  )}
                </div>

                {abertoPara !== ano && (
                  <Button size="sm" variant="outline" onClick={() => setAbertoPara(ano)}>
                    <Plus className="size-3.5" />
                    {vigente ? 'Mudar percentual' : 'Definir percentual'}
                  </Button>
                )}
              </div>

              {futuros.length > 0 && (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900">
                  <strong>Já agendado:</strong>{' '}
                  {futuros
                    .map(
                      (f) =>
                        `${fmtPercentual(f.percentual)} a partir de ${fmtVigencia(f.vigenteDesde)}`,
                    )
                    .join(' · ')}
                </div>
              )}

              {abertoPara === ano && (
                <FormularioFator
                  ano={ano}
                  anterior={vigente}
                  hojeIso={hojeIso}
                  pending={pending}
                  onCancelar={() => setAbertoPara(null)}
                  onSalvar={(dados) =>
                    startTransition(async () => {
                      const res = await salvarFator(dados);
                      if (!res.ok) {
                        toast.error(res.error, { duration: 9000 });
                        return;
                      }
                      toast.success(`LOA ${dados.loaAno}: ${fmtPercentual(dados.percentual)}`);
                      setAbertoPara(null);
                      router.refresh();
                    })
                  }
                />
              )}

              {passados.length > 0 && (
                <details className="text-xs">
                  <summary className="inline-flex cursor-pointer items-center gap-1 text-neutral-500 hover:text-neutral-800">
                    <History className="size-3" />
                    {passados.length}{' '}
                    {passados.length === 1 ? 'valor anterior' : 'valores anteriores'}
                  </summary>
                  <ul className="mt-2 space-y-1 border-l border-neutral-200 pl-3 text-neutral-500">
                    {passados.map((f) => (
                      <li key={f.id}>
                        <span className="tabular-nums">{fmtPercentual(f.percentual)}</span> sobre o{' '}
                        {ROTULO_BASE[f.base]} · de {fmtVigencia(f.vigenteDesde)}
                        {f.observacao && <span className="italic"> — {f.observacao}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardContent className="pt-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              abrirOutraLoa();
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <div>
              <Label htmlFor="outra-loa">Outra LOA</Label>
              <Input
                id="outra-loa"
                inputMode="numeric"
                placeholder="2029"
                value={novoAno}
                onChange={(e) => setNovoAno(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="mt-1 w-28"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={!novoAnoValido}>
              <Plus className="size-3.5" />
              Definir percentual
            </Button>
            <p className="w-full text-xs text-neutral-500">
              Para cadastrar o percentual de uma LOA que ainda não tem operação.
            </p>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-neutral-500">
        O percentual de uma data é o da vigência mais recente que já começou. Não dá pra criar
        vigência anterior a uma que já existe, e um percentual que já foi usado em proposta não muda
        mais: para mudar o preço, cadastre uma nova vigência. Assim uma proposta já feita continua
        explicada pelo número que foi de fato usado.
      </p>
    </div>
  );
}

/**
 * O formulário.
 *
 * A pergunta da base aparece com as palavras do problema, não com o nome da
 * coluna: num precatório de R$ 1 milhão com R$ 400 mil de deduções, 55% da
 * face são R$ 550 mil e 55% do líquido são R$ 330 mil. Quem preenche tem que
 * ver essa diferença antes de escolher.
 */
function FormularioFator({
  ano,
  anterior,
  hojeIso,
  pending,
  onCancelar,
  onSalvar,
}: {
  ano: number;
  anterior: FatorLoa | null;
  hojeIso: string;
  pending: boolean;
  onCancelar: () => void;
  onSalvar: (dados: {
    loaAno: number;
    percentual: number;
    base: BaseDesagio;
    vigenteDesde: string;
    observacao: string;
  }) => void;
}) {
  const [percentual, setPercentual] = useState('');
  const [base, setBase] = useState<BaseDesagio | ''>(anterior?.base ?? '');
  const [vigenteDesde, setVigenteDesde] = useState(hojeIso);
  const [observacao, setObservacao] = useState('');

  const num = Number(percentual.replace(',', '.'));
  const valido = Number.isFinite(num) && num > 0 && num <= 100 && base !== '';

  // Prévia com números redondos, pra conferir a ordem de grandeza antes de
  // salvar — é o mesmo exemplo que foi pro Renato por WhatsApp.
  const previa = valido
    ? base === 'face'
      ? (1_000_000 * num) / 100
      : (600_000 * num) / 100
    : null;

  return (
    <div className="space-y-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`pct-${ano}`}>Percentual a pagar</Label>
          <div className="flex items-center gap-2">
            <Input
              id={`pct-${ano}`}
              value={percentual}
              onChange={(e) => setPercentual(e.target.value)}
              disabled={pending}
              inputMode="decimal"
              placeholder="55"
              className="w-28"
              autoFocus
            />
            <span className="text-sm text-neutral-500">%</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`desde-${ano}`}>Vale a partir de</Label>
          <Input
            id={`desde-${ano}`}
            type="date"
            value={vigenteDesde}
            min={anterior?.vigenteDesde}
            onChange={(e) => setVigenteDesde(e.target.value)}
            disabled={pending}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium text-neutral-900">
          O percentual incide sobre o quê?
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <OpcaoBase
            valor="liquido"
            selecionado={base === 'liquido'}
            onSelecionar={setBase}
            disabled={pending}
            titulo="O líquido cedível"
            detalhe="O que sobra depois de PSS, IR e honorários. Res. CJF 983/2026, art. 22."
          />
          <OpcaoBase
            valor="face"
            selecionado={base === 'face'}
            onSelecionar={setBase}
            disabled={pending}
            titulo="O valor de face"
            detalhe="O valor cheio do precatório, antes de qualquer dedução."
          />
        </div>
      </fieldset>

      {previa !== null && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900">
          <strong>Confira a ordem de grandeza:</strong> num precatório de R$ 1 milhão com R$ 400 mil
          de deduções (líquido de R$ 600 mil), {fmtPercentual(num)} sobre o{' '}
          {ROTULO_BASE[base as BaseDesagio]} dá uma proposta de{' '}
          <strong>{previa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>.
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`obs-${ano}`}>Por que mudou (opcional)</Label>
        <Textarea
          id={`obs-${ano}`}
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          rows={2}
          disabled={pending}
          placeholder="Ex: liberaram o orçamento, ente entrou em regime especial"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancelar} disabled={pending}>
          Cancelar
        </Button>
        <Button
          size="sm"
          disabled={pending || !valido}
          onClick={() =>
            onSalvar({
              loaAno: ano,
              percentual: num,
              base: base as BaseDesagio,
              vigenteDesde,
              observacao,
            })
          }
        >
          {pending ? <Spinner size={3} /> : <TrendingUp className="size-3.5" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}

function OpcaoBase({
  valor,
  selecionado,
  onSelecionar,
  disabled,
  titulo,
  detalhe,
}: {
  valor: BaseDesagio;
  selecionado: boolean;
  onSelecionar: (v: BaseDesagio) => void;
  disabled: boolean;
  titulo: string;
  detalhe: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelecionar(valor)}
      disabled={disabled}
      className={cn(
        'rounded-md border p-2.5 text-left transition-colors',
        selecionado
          ? 'border-neutral-900 bg-white ring-1 ring-neutral-900'
          : 'border-neutral-200 bg-white hover:border-neutral-400',
      )}
    >
      <div className="text-sm font-medium text-neutral-900">{titulo}</div>
      <div className="mt-0.5 text-[11px] text-neutral-500">{detalhe}</div>
    </button>
  );
}
