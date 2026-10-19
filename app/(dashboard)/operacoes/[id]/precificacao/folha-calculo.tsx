import { AlertTriangle, FileText, Calculator, Pencil, Hash } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LinhaCascata, OrigemValor, ResultadoCascata } from '@/lib/precificacao/tipos';

/**
 * A conta, aberta.
 *
 * O formato imita um cálculo de contadoria judicial de propósito: é o
 * documento que um advogado sabe conferir. Caixa preta que cospe um número
 * final não serve — ele confere, não encontra de onde saiu, e volta pro Excel.
 *
 * Cada linha carrega três coisas além do valor: de onde o número veio, o
 * dispositivo que obriga aquela dedução a existir, e quanto ela pesa sobre o
 * crédito. O peso é o que permite ver que honorário levou 20% e imposto 6%
 * sem abrir calculadora.
 */

type Operacao = {
  id: string;
  numeroProcesso: string;
  cedente: string;
  tipo: string;
  natureza: string | null;
  especie: string | null;
  tribunal: string;
  enteDevedor: string | null;
  loa: number | null;
  dataBase: string | null;
  indice: string | null;
  percentualAquisicao: number | null;
  precoProposto: number | null;
  etapaAtual: string;
};

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtData = (iso: string) => {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
};

const ROTULO_INDICE: Record<string, string> = {
  selic: 'Selic',
  ipca: 'IPCA',
  ipca_15: 'IPCA-15',
  inpc: 'INPC',
  poupanca: 'Poupança',
  tr: 'TR',
};

/** Selo de procedência. É o que diferencia número lido de número calculado. */
function SeloOrigem({ origem }: { origem: OrigemValor }) {
  const def: Record<OrigemValor, { texto: string; cls: string; Icone: typeof FileText }> = {
    oficio: {
      texto: 'ofício',
      cls: 'border-blue-200 bg-blue-50 text-blue-700',
      Icone: FileText,
    },
    calculado: {
      texto: 'calculado',
      cls: 'border-neutral-200 bg-neutral-50 text-neutral-600',
      Icone: Calculator,
    },
    digitado: {
      texto: 'digitado',
      cls: 'border-amber-200 bg-amber-50 text-amber-700',
      Icone: Pencil,
    },
    falta: {
      texto: 'falta',
      cls: 'border-red-200 bg-red-50 text-red-700',
      Icone: AlertTriangle,
    },
  };
  const { texto, cls, Icone } = def[origem];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <Icone className="size-2.5" />
      {texto}
    </span>
  );
}

function Linha({ l }: { l: LinhaCascata }) {
  const ehSubtotal = l.destaque === true;
  const ehFalta = l.origem === 'falta';

  return (
    <div
      className={`grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[1fr_90px_150px] ${
        ehSubtotal ? 'bg-neutral-50' : ''
      } ${ehFalta ? 'bg-red-50/40' : ''}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-sm ${ehSubtotal ? 'font-semibold text-neutral-900' : 'text-neutral-700'}`}
          >
            {l.sinal !== '=' && <span className="mr-1 text-neutral-400">{l.sinal}</span>}
            {l.rotulo}
          </span>
          <SeloOrigem origem={l.origem} />
        </div>
        {(l.detalhe || l.norma) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-500">
            {l.detalhe && <span>{l.detalhe}</span>}
            {l.norma && (
              <span className="inline-flex items-center gap-1 text-neutral-400">
                <Hash className="size-2.5" />
                {l.norma}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="hidden text-right text-xs text-neutral-400 tabular-nums sm:block">
        {l.percentualDoTotal !== undefined ? `${l.percentualDoTotal.toFixed(2)}%` : ''}
      </div>

      <div
        className={`text-right tabular-nums ${
          ehSubtotal ? 'text-base font-semibold text-neutral-900' : 'text-sm text-neutral-800'
        }`}
      >
        {l.valor === null ? (
          <span className="text-sm font-medium text-red-600">—</span>
        ) : (
          fmtBRL(l.valor)
        )}
      </div>
    </div>
  );
}

export function FolhaCalculo({
  operacao,
  cascata,
  dataFinal,
  faltaBase,
  erroFator,
  metodoFator,
  competenciaFinal,
  podeEditar,
}: {
  operacao: Operacao;
  cascata: ResultadoCascata | null;
  dataFinal: string;
  faltaBase: string[];
  erroFator: string | null;
  metodoFator: string | null;
  competenciaFinal: string | null;
  podeEditar: boolean;
}) {
  const liquido = cascata?.liquidoDisponivel ?? null;

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {operacao.cedente}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500">
          <span className="font-mono text-xs">{operacao.numeroProcesso}</span>
          <span>{operacao.tribunal}</span>
          {operacao.enteDevedor && <span>{operacao.enteDevedor}</span>}
          {operacao.loa && <span>LOA {operacao.loa}</span>}
        </div>
      </div>

      {/* Bloqueio de dados faltando */}
      {faltaBase.length > 0 && (
        <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            <div className="font-semibold">
              Não dá pra calcular sem {faltaBase.length === 1 ? 'isto' : 'estes dados'}
            </div>
            <ul className="mt-1.5 list-inside list-disc">
              {faltaBase.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <p className="mt-2 text-red-800">
              Esses campos vêm do ofício requisitório. Complete o cadastro da operação e volte.
            </p>
          </div>
        </div>
      )}

      {erroFator && (
        <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            <div className="font-semibold">A correção monetária não pôde ser aplicada</div>
            <p className="mt-1">{erroFator}</p>
          </div>
        </div>
      )}

      {cascata && (
        <>
          {/* A conta */}
          <Card className="overflow-hidden p-0">
            <CardHeader className="border-b border-neutral-200 bg-white px-4 py-3">
              <CardTitle className="text-sm font-semibold">
                Memória de cálculo
                {operacao.dataBase && (
                  <span className="ml-2 font-normal text-neutral-500">
                    de {fmtData(operacao.dataBase)} até {fmtData(dataFinal)}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="hidden grid-cols-[1fr_90px_150px] gap-x-4 border-b border-neutral-100 px-4 py-2 text-[10px] font-medium tracking-wide text-neutral-400 uppercase sm:grid">
                <div>Linha</div>
                <div className="text-right">% do total</div>
                <div className="text-right">Valor</div>
              </div>
              <div className="divide-y divide-neutral-100">
                {cascata.linhas.map((l) => (
                  <Linha key={l.id} l={l} />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Pendências que não impedem a conta */}
          {cascata.bloqueios.length > 0 && (
            <div className="space-y-2">
              {cascata.bloqueios.map((b) => (
                <div
                  key={b.campo}
                  className={`flex gap-2.5 rounded-md border p-3 text-sm ${
                    b.impedeTotal
                      ? 'border-red-200 bg-red-50 text-red-900'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>{b.mensagem}</span>
                </div>
              ))}
            </div>
          )}

          {/* Resultado */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Base para a proposta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <div>
                  <div className="text-[11px] font-medium tracking-wide text-neutral-500 uppercase">
                    Líquido disponível
                  </div>
                  <div className="mt-0.5 text-[11px] text-neutral-500">
                    é sobre este valor que incide o deságio
                  </div>
                </div>
                <div className="text-2xl font-semibold text-neutral-900 tabular-nums">
                  {liquido === null ? (
                    <span className="text-base text-red-600">não calculável</span>
                  ) : (
                    fmtBRL(liquido)
                  )}
                </div>
              </div>

              {/* O deságio ainda não é automático — e a tela diz isso. */}
              <div className="rounded-lg border border-dashed border-neutral-300 p-4">
                <div className="text-sm font-medium text-neutral-900">
                  Preço proposto ao cedente
                </div>
                <div className="mt-1.5 flex flex-wrap items-end justify-between gap-3">
                  <p className="max-w-md text-xs text-neutral-500">
                    O cálculo automático do deságio depende da régua por ano de LOA, que ainda não
                    está configurada. Por enquanto o preço é digitado na operação, e esta tela serve
                    pra conferir a base.
                  </p>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-neutral-900 tabular-nums">
                      {operacao.precoProposto !== null ? fmtBRL(operacao.precoProposto) : '—'}
                    </div>
                    {operacao.precoProposto !== null && liquido !== null && liquido > 0 && (
                      <div className="text-[11px] text-neutral-500">
                        {((operacao.precoProposto / liquido) * 100).toFixed(2)}% do líquido
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Procedência do cálculo */}
          <div className="rounded-lg border border-neutral-200 bg-white p-4 text-xs text-neutral-500">
            <div className="mb-1.5 font-medium text-neutral-700">Como esta conta foi feita</div>
            <ul className="space-y-1">
              <li>
                Correção pelo índice que o ofício determina
                {operacao.indice && (
                  <strong className="text-neutral-700">
                    {' '}
                    ({ROTULO_INDICE[operacao.indice] ?? operacao.indice})
                  </strong>
                )}
                {metodoFator === 'numero_indice'
                  ? ', pela razão entre números-índice'
                  : metodoFator === 'encadeamento'
                    ? ', encadeando as variações mensais'
                    : ''}
                .
              </li>
              {competenciaFinal && (
                <li>
                  Série disponível até{' '}
                  <strong className="text-neutral-700">
                    {competenciaFinal.slice(5, 7)}/{competenciaFinal.slice(0, 4)}
                  </strong>
                  .
                </li>
              )}
              <li>
                O imposto incide sobre o principal atualizado — juros de mora em verba alimentar não
                são renda tributável (STF, Tema 808).
              </li>
              <li>
                Honorários sucumbenciais não aparecem como dedução: no ofício eles são beneficiário
                próprio e recebem direto do ente devedor.
              </li>
            </ul>
          </div>
        </>
      )}

      {!podeEditar && (
        <p className="text-xs text-neutral-400">
          Você está vendo em modo leitura. Alterar valores exige perfil admin ou gestão.
        </p>
      )}
    </div>
  );
}
