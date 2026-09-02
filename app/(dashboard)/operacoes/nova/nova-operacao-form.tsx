'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ArrowLeft, ArrowRight, Check, Info, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { criarOperacao } from './actions';
import {
  ESFERAS,
  ESPECIES,
  ESTADOS_CIVIS,
  NATUREZAS,
  TIPOS_ATIVO,
  step1Schema,
  step2Schema,
  step3Schema,
} from './schemas';
import { TRIBUNAIS_POR_ESFERA, type Esfera } from '@/lib/tribunais';
import { maskCPF as fmtCPF, maskCNJ } from '@/lib/masks';
import { fmtDataBR } from '@/lib/formatters';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type EnteDevedor = {
  id: string;
  nome: string;
  esfera: Esfera;
  uf: string | null;
  situacao: string;
};

type Props = {
  entesDevedores: EnteDevedor[];
  podeMunicipal: boolean;
  leadInicial?: { id: string; nome: string; cpf: string } | null;
};

type Step1State = {
  cedente_nome: string;
  cedente_cpf: string;
  cedente_data_nascimento: string;
  cedente_estado_civil: string;
  numero_processo: string;
  tipo: string;
  natureza: string;
  esfera: string;
  tribunal: string;
  ente_devedor_id: string;
  especie: string;
  data_base: string;
  data_autuacao: string;
  loa: string;
};

type Step2State = {
  valor_principal: string;
  valor_juros: string;
  valor_selic: string;
  retencao_honorarios_pct: string;
  percentual_aquisicao: string;
  pss_ativo: boolean;
  pss_pct: string;
  rra_ativo: boolean;
  rra_meses: string;
  observacoes: string;
};

const initialStep1: Step1State = {
  cedente_nome: '',
  cedente_cpf: '',
  cedente_data_nascimento: '',
  cedente_estado_civil: '',
  numero_processo: '',
  tipo: '',
  natureza: '',
  esfera: '',
  tribunal: '',
  ente_devedor_id: '',
  especie: '',
  data_base: '',
  data_autuacao: '',
  loa: '',
};

const initialStep2: Step2State = {
  valor_principal: '',
  valor_juros: '',
  valor_selic: '',
  retencao_honorarios_pct: '0',
  percentual_aquisicao: '100',
  pss_ativo: false,
  pss_pct: '',
  rra_ativo: false,
  rra_meses: '',
  observacoes: '',
};

function parseNumero(v: string): number {
  return Number(v.replace(',', '.')) || 0;
}

const RASCUNHO_KEY = 'rgt:draft:nova-operacao';
const RASCUNHO_DEBOUNCE_MS = 800;

type RascunhoStorage = {
  savedAt: number;
  s1: Step1State;
  s2: Step2State;
  step: 1 | 2 | 3;
};

function lerRascunho(): RascunhoStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(RASCUNHO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RascunhoStorage;
    if (!parsed?.s1 || !parsed?.s2 || !parsed?.savedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function limparRascunho() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(RASCUNHO_KEY);
  } catch {
    // ignore
  }
}

function fmtRascunhoIdade(savedAt: number): string {
  const mins = Math.floor((Date.now() - savedAt) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins} min atrás`;
  const horas = Math.floor(mins / 60);
  if (horas < 24) return `${horas}h atrás`;
  const dias = Math.floor(horas / 24);
  return `${dias}d atrás`;
}

export function NovaOperacaoForm({ entesDevedores, podeMunicipal, leadInicial }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [s1, setS1] = useState<Step1State>(
    leadInicial
      ? { ...initialStep1, cedente_nome: leadInicial.nome, cedente_cpf: fmtCPF(leadInicial.cpf) }
      : initialStep1,
  );
  const [s2, setS2] = useState<Step2State>(initialStep2);
  const [aceite, setAceite] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroServer, setErroServer] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rascunhoInicializado = useRef(false);

  useEffect(() => {
    if (rascunhoInicializado.current) return;
    rascunhoInicializado.current = true;
    if (leadInicial) return;
    const r = lerRascunho();
    if (r) {
      setS1(r.s1);
      setS2(r.s2);
      setStep(r.step);
      toast.info(`Rascunho restaurado (${fmtRascunhoIdade(r.savedAt)})`, {
        description:
          'Continue de onde parou. Descarte pelo botão abaixo se preferir começar do zero.',
        action: {
          label: 'Descartar',
          onClick: () => descartarRascunho(),
        },
        duration: 8000,
      });
    }
     
  }, [leadInicial]);

  useEffect(() => {
    if (!rascunhoInicializado.current) return;
    const t = setTimeout(() => {
      const isEmpty = !s1.cedente_nome && !s1.numero_processo && !s2.valor_principal;
      if (isEmpty) return;
      try {
        localStorage.setItem(
          RASCUNHO_KEY,
          JSON.stringify({ savedAt: Date.now(), s1, s2, step } satisfies RascunhoStorage),
        );
      } catch {
        // ignore
      }
    }, RASCUNHO_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [s1, s2, step]);

  function descartarRascunho() {
    limparRascunho();
    setS1(initialStep1);
    setS2(initialStep2);
    setStep(1);
    setErros({});
    toast.success('Rascunho descartado. Formulário limpo.');
  }

  const esferasVisiveis = podeMunicipal ? ESFERAS : ESFERAS.filter((e) => e.value !== 'municipal');

  const tribunaisDisponiveis = useMemo(() => {
    if (!s1.esfera) return [];
    return TRIBUNAIS_POR_ESFERA[s1.esfera as Esfera] ?? [];
  }, [s1.esfera]);

  const entesFiltrados = useMemo(() => {
    if (!s1.esfera) return [];
    return entesDevedores.filter(
      (e) => e.esfera === s1.esfera && (podeMunicipal || e.esfera !== 'municipal'),
    );
  }, [entesDevedores, s1.esfera, podeMunicipal]);

  const enteSelecionado = useMemo(
    () => entesFiltrados.find((e) => e.id === s1.ente_devedor_id),
    [entesFiltrados, s1.ente_devedor_id],
  );

  const valorTotal = useMemo(() => {
    return (
      parseNumero(s2.valor_principal) + parseNumero(s2.valor_juros) + parseNumero(s2.valor_selic)
    );
  }, [s2.valor_principal, s2.valor_juros, s2.valor_selic]);

  function updateS1<K extends keyof Step1State>(key: K, value: Step1State[K]) {
    setS1((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'esfera') {
        next.tribunal = '';
        next.ente_devedor_id = '';
      }
      return next;
    });
    setErros((e) => ({ ...e, [key]: '' }));
  }

  function updateS2<K extends keyof Step2State>(key: K, value: Step2State[K]) {
    setS2((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'pss_ativo' && value === false) next.pss_pct = '';
      if (key === 'rra_ativo' && value === false) next.rra_meses = '';
      return next;
    });
    setErros((e) => ({ ...e, [key]: '' }));
  }

  function irPara(destino: 1 | 2 | 3) {
    setErros({});
    setErroServer(null);
    if (destino > step) {
      if (step === 1) {
        const cpfDigits = s1.cedente_cpf.replace(/\D/g, '');
        const parsed = step1Schema.safeParse({ ...s1, cedente_cpf: cpfDigits });
        if (!parsed.success) {
          const errs: Record<string, string> = {};
          for (const iss of parsed.error.issues) {
            const k = iss.path[0];
            if (typeof k === 'string') errs[k] = iss.message;
          }
          setErros(errs);
          return;
        }
      }
      if (step === 2) {
        const parsed = step2Schema.safeParse(s2);
        if (!parsed.success) {
          const errs: Record<string, string> = {};
          for (const iss of parsed.error.issues) {
            const k = iss.path[0];
            if (typeof k === 'string') errs[k] = iss.message;
          }
          setErros(errs);
          return;
        }
      }
    }
    setStep(destino);
  }

  function submeter() {
    setErroServer(null);
    const parsed3 = step3Schema.safeParse({ aceite_termos: aceite });
    if (!parsed3.success) {
      setErros({ aceite_termos: parsed3.error.issues[0]?.message ?? 'Aceite obrigatório' });
      return;
    }

    const step1Payload = { ...s1, cedente_cpf: s1.cedente_cpf.replace(/\D/g, '') };

    startTransition(async () => {
      const res = await criarOperacao({
        step1: step1Payload,
        step2: s2,
        leadId: leadInicial?.id,
      });
      if (res && !res.ok) {
        setErroServer(res.error);
        setStep(1);
        return;
      }
      limparRascunho();
    });
  }

  return (
    <TooltipProvider>
      <div>
        <StepIndicator step={step} />

        {erroServer && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Erro ao criar operação</AlertTitle>
            <AlertDescription>{erroServer}</AlertDescription>
          </Alert>
        )}

        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Dados do ativo</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FieldText
                label="Nome do cedente"
                value={s1.cedente_nome}
                onChange={(v) => updateS1('cedente_nome', v)}
                error={erros.cedente_nome}
                required
                className="sm:col-span-2"
              />
              <FieldText
                label="CPF do cedente"
                value={s1.cedente_cpf}
                onChange={(v) => updateS1('cedente_cpf', fmtCPF(v))}
                placeholder="000.000.000-00"
                error={erros.cedente_cpf}
                required
              />
              <FieldText
                label="Data de nascimento"
                value={s1.cedente_data_nascimento}
                onChange={(v) => updateS1('cedente_data_nascimento', v)}
                type="date"
                hint="Opcional. Se >75 anos, laudo médico vira obrigatório na aba Documentos."
                error={erros.cedente_data_nascimento}
              />
              <FieldSelect
                label="Estado civil"
                value={s1.cedente_estado_civil}
                onChange={(v) => updateS1('cedente_estado_civil', v)}
                options={ESTADOS_CIVIS}
                hint="Opcional. Casado exige certidão casamento; senão, certidão nascimento."
                error={erros.cedente_estado_civil}
              />
              <FieldText
                label="Número do processo"
                value={s1.numero_processo}
                onChange={(v) => updateS1('numero_processo', maskCNJ(v))}
                placeholder="0000000-00.0000.0.00.0000"
                error={erros.numero_processo}
                required
              />
              <FieldSelect
                label="Tipo de ativo"
                value={s1.tipo}
                onChange={(v) => updateS1('tipo', v)}
                options={TIPOS_ATIVO}
                error={erros.tipo}
                required
              />
              <FieldSelect
                label="Natureza"
                value={s1.natureza}
                onChange={(v) => updateS1('natureza', v)}
                options={NATUREZAS}
                error={erros.natureza}
                required
              />
              <FieldSelect
                label="Esfera"
                value={s1.esfera}
                onChange={(v) => updateS1('esfera', v)}
                options={esferasVisiveis}
                error={erros.esfera}
                required
              />
              <FieldSelect
                label="Tribunal"
                value={s1.tribunal}
                onChange={(v) => updateS1('tribunal', v)}
                options={tribunaisDisponiveis.map((t) => ({ value: t, label: t }))}
                error={erros.tribunal}
                required
                disabled={!s1.esfera}
                hint={!s1.esfera ? 'Selecione a esfera primeiro' : undefined}
              />
              <FieldSelect
                label="Ente devedor"
                value={s1.ente_devedor_id}
                onChange={(v) => updateS1('ente_devedor_id', v)}
                options={entesFiltrados.map((e) => ({
                  value: e.id,
                  label: e.uf ? `${e.nome} (${e.uf})` : e.nome,
                }))}
                error={erros.ente_devedor_id}
                required
                disabled={!s1.esfera}
                hint={!s1.esfera ? 'Selecione a esfera primeiro' : undefined}
              />
              {enteSelecionado?.situacao === 'regime_especial' && (
                <Alert variant="destructive" className="sm:col-span-2">
                  <Info className="size-4" />
                  <AlertTitle>Ente em regime especial</AlertTitle>
                  <AlertDescription>
                    A RGT normalmente não opera este ente. Apenas admin consegue salvar.
                  </AlertDescription>
                </Alert>
              )}
              <FieldSelect
                label="Espécie"
                value={s1.especie}
                onChange={(v) => updateS1('especie', v)}
                options={ESPECIES}
                error={erros.especie}
                required
              />
              <FieldText
                label="Data-base do cálculo"
                value={s1.data_base}
                onChange={(v) => updateS1('data_base', v)}
                type="date"
                error={erros.data_base}
                required
              />
              <FieldText
                label="Data de autuação"
                value={s1.data_autuacao}
                onChange={(v) => updateS1('data_autuacao', v)}
                type="date"
                error={erros.data_autuacao}
              />
              <FieldText
                label="LOA estimada (ano)"
                value={s1.loa}
                onChange={(v) => updateS1('loa', v)}
                placeholder="Ex: 2027"
                error={erros.loa}
              />
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Valores do cedente</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <FieldText
                    label="Valor principal (R$)"
                    value={s2.valor_principal}
                    onChange={(v) => updateS2('valor_principal', v)}
                    error={erros.valor_principal}
                    required
                  />
                  <FieldText
                    label="Valor dos juros (R$)"
                    value={s2.valor_juros}
                    onChange={(v) => updateS2('valor_juros', v)}
                    error={erros.valor_juros}
                    required
                  />
                  <FieldText
                    label="Valor SELIC (R$)"
                    value={s2.valor_selic}
                    onChange={(v) => updateS2('valor_selic', v)}
                    error={erros.valor_selic}
                    hint="Opcional"
                  />
                </div>
                <div className="rounded-md bg-neutral-100 p-3 text-sm text-neutral-700">
                  <strong>Valor total:</strong>{' '}
                  {valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Deduções</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FieldText
                    label="Retenção de honorários (%)"
                    value={s2.retencao_honorarios_pct}
                    onChange={(v) => updateS2('retencao_honorarios_pct', v)}
                    error={erros.retencao_honorarios_pct}
                  />
                  <FieldText
                    label="Percentual de aquisição (%)"
                    value={s2.percentual_aquisicao}
                    onChange={(v) => updateS2('percentual_aquisicao', v)}
                    error={erros.percentual_aquisicao}
                    hint="100 = compra integral. <100 = compra parcial."
                  />
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={s2.pss_ativo}
                      onChange={(e) => updateS2('pss_ativo', e.target.checked)}
                      className="h-4 w-4 cursor-pointer"
                    />
                    <span>Ativar PSS (Plano de Seguridade Social)</span>
                    <InfoTip text="PSS = contribuição previdenciária retida pelo tribunal. Marque se o precatório do cedente sofre desconto de PSS (comum em servidores públicos). Percentual típico: 11%." />
                  </label>
                  {s2.pss_ativo && (
                    <FieldText
                      label="Percentual PSS (%)"
                      value={s2.pss_pct}
                      onChange={(v) => updateS2('pss_pct', v)}
                      error={erros.pss_pct}
                      placeholder="Ex: 11"
                      required
                    />
                  )}

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={s2.rra_ativo}
                      onChange={(e) => updateS2('rra_ativo', e.target.checked)}
                      className="h-4 w-4 cursor-pointer"
                    />
                    <span>Ativar IR / RRA (Rendimento Recebido Acumuladamente)</span>
                    <InfoTip text="RRA = Rendimento Recebido Acumuladamente. Marque quando o crédito acumula meses de atraso (regime especial de IR). 0 meses = IR fixo 3%. >0 meses = tabela progressiva sobre valor dividido pelo número de meses." />
                  </label>
                  {s2.rra_ativo && (
                    <FieldText
                      label="Meses acumulados (RRA)"
                      value={s2.rra_meses}
                      onChange={(v) => updateS2('rra_meses', v)}
                      error={erros.rra_meses}
                      hint="0 = IR fixo 3%. >0 = cálculo por meses acumulados."
                      placeholder="Ex: 60"
                      required
                    />
                  )}
                </div>

                <FieldTextarea
                  label="Observações sobre o cedente"
                  value={s2.observacoes}
                  onChange={(v) => updateS2('observacoes', v)}
                  hint="Opcional. Ex: procurador, urgência, contexto."
                />
              </CardContent>
            </Card>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <Alert>
              <Info className="size-4" />
              <AlertTitle>Documentos</AlertTitle>
              <AlertDescription>
                Após criar a operação, anexe o <strong>Ofício Requisitório</strong> e demais
                documentos na aba <em>Documentos</em> da tela de detalhe.
              </AlertDescription>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle>Revisão</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <ReviewItem label="Cedente" value={s1.cedente_nome} />
                  <ReviewItem label="CPF" value={s1.cedente_cpf} />
                  <ReviewItem label="Nascimento" value={fmtDataBR(s1.cedente_data_nascimento)} />
                  <ReviewItem
                    label="Estado civil"
                    value={
                      ESTADOS_CIVIS.find((e) => e.value === s1.cedente_estado_civil)?.label ?? '—'
                    }
                  />
                  <ReviewItem label="Processo" value={s1.numero_processo} />
                  <ReviewItem
                    label="Tipo"
                    value={TIPOS_ATIVO.find((t) => t.value === s1.tipo)?.label ?? '—'}
                  />
                  <ReviewItem
                    label="Natureza"
                    value={NATUREZAS.find((n) => n.value === s1.natureza)?.label ?? '—'}
                  />
                  <ReviewItem
                    label="Esfera"
                    value={ESFERAS.find((e) => e.value === s1.esfera)?.label ?? '—'}
                  />
                  <ReviewItem label="Tribunal" value={s1.tribunal || '—'} />
                  <ReviewItem
                    label="Ente devedor"
                    value={entesDevedores.find((e) => e.id === s1.ente_devedor_id)?.nome ?? '—'}
                  />
                  <ReviewItem
                    label="Espécie"
                    value={ESPECIES.find((e) => e.value === s1.especie)?.label ?? '—'}
                  />
                  <ReviewItem label="Data-base" value={fmtDataBR(s1.data_base)} />
                  <ReviewItem label="LOA" value={s1.loa || '—'} />
                  <ReviewItem
                    label="Principal"
                    value={Number(s2.valor_principal.replace(',', '.') || 0).toLocaleString(
                      'pt-BR',
                      { style: 'currency', currency: 'BRL' },
                    )}
                  />
                  <ReviewItem
                    label="Juros"
                    value={Number(s2.valor_juros.replace(',', '.') || 0).toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  />
                  <ReviewItem
                    label="SELIC"
                    value={
                      s2.valor_selic
                        ? Number(s2.valor_selic.replace(',', '.')).toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          })
                        : '—'
                    }
                  />
                  <ReviewItem
                    label="Retenção honorários"
                    value={`${s2.retencao_honorarios_pct}%`}
                  />
                  <ReviewItem label="Aquisição" value={`${s2.percentual_aquisicao}%`} />
                  <ReviewItem
                    label="Valor total"
                    value={valorTotal.toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  />
                </dl>
              </CardContent>
            </Card>

            <label
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-sm transition-colors',
                aceite
                  ? 'border-emerald-300 bg-emerald-50'
                  : erros.aceite_termos
                    ? 'border-red-400 bg-red-50'
                    : 'border-amber-300 bg-amber-50',
              )}
            >
              <input
                type="checkbox"
                checked={aceite}
                onChange={(e) => {
                  setAceite(e.target.checked);
                  setErros((prev) => ({ ...prev, aceite_termos: '' }));
                }}
                className="mt-0.5 h-4 w-4 cursor-pointer"
              />
              <span className="font-medium">
                Confirmo que os dados acima estão corretos e desejo enviar a solicitação de
                operação.
                {!aceite && <span className="ml-1 text-red-600">*</span>}
              </span>
            </label>
            {erros.aceite_termos && <p className="text-xs text-red-600">{erros.aceite_termos}</p>}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-neutral-200 pt-4">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => step > 1 && irPara((step - 1) as 1 | 2)}
              disabled={step === 1 || pending}
            >
              <ArrowLeft className="size-4" />
              Voltar
            </Button>
            {step === 1 && (
              <Button
                variant="ghost"
                onClick={() => {
                  if (confirm('Descartar rascunho e começar do zero?')) descartarRascunho();
                }}
                disabled={pending}
                className="text-neutral-500"
              >
                <Trash2 className="size-4" />
                Descartar
              </Button>
            )}
          </div>

          {step < 3 ? (
            <Button onClick={() => irPara((step + 1) as 2 | 3)} disabled={pending}>
              Próximo
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button
              onClick={submeter}
              disabled={pending || !aceite}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {pending ? (
                'Enviando…'
              ) : (
                <>
                  <Send className="size-4" />
                  Enviar solicitação
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const items = [
    { n: 1, label: 'Dados do ativo' },
    { n: 2, label: 'Valores e deduções' },
    { n: 3, label: 'Documentos e envio' },
  ];
  return (
    <ol className="mb-6 flex items-center gap-2">
      {items.map((item, i) => {
        const active = item.n === step;
        const done = item.n < step;
        return (
          <li key={item.n} className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-8 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                active && 'bg-neutral-900 text-white ring-4 ring-neutral-900/10',
                done && 'bg-emerald-600 text-white',
                !active && !done && 'bg-neutral-200 text-neutral-500',
              )}
            >
              {done ? <Check className="size-4" strokeWidth={2.5} /> : item.n}
            </span>
            <span
              className={cn(
                'text-sm',
                active ? 'font-medium text-neutral-900' : 'text-neutral-500',
              )}
            >
              {item.label}
            </span>
            {i < items.length - 1 && (
              <span
                className={cn(
                  'mx-2 h-px w-8 transition-colors',
                  done ? 'bg-emerald-600' : 'bg-neutral-300',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="ml-0.5 inline-flex items-center text-neutral-400 hover:text-neutral-700"
            aria-label="Mais informações"
          />
        }
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

type Option = { value: string; label: string };

function FieldText({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
  hint,
  required,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
}) {
  const id = useMemo(() => `f-${label.replace(/\W+/g, '-').toLowerCase()}`, [label]);
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-red-600"> *</span>}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
      />
      {error ? (
        <span className="text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="text-xs text-neutral-500">{hint}</span>
      ) : null}
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  error,
  hint,
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly Option[];
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useMemo(() => `s-${label.replace(/\W+/g, '-').toLowerCase()}`, [label]);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-red-600"> *</span>}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        className={cn(
          'h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-neutral-900 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400',
          error && 'border-red-400',
        )}
      >
        <option value="">Selecione…</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="text-xs text-neutral-500">{hint}</span>
      ) : null}
    </div>
  );
}

function FieldTextarea({
  label,
  value,
  onChange,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
}) {
  const id = useMemo(() => `t-${label.replace(/\W+/g, '-').toLowerCase()}`, [label]);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        aria-invalid={Boolean(error)}
      />
      {error ? (
        <span className="text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="text-xs text-neutral-500">{hint}</span>
      ) : null}
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium text-neutral-900">{value}</dd>
    </>
  );
}
