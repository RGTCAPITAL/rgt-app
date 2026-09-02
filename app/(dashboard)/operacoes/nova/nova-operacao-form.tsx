'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
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

import { maskCPF as fmtCPF, maskCNJ } from '@/lib/masks';
import { fmtDataBR } from '@/lib/formatters';

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
    // ignore (private mode, quota exceeded, etc)
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
  const [rascunhoRestaurado, setRascunhoRestaurado] = useState<RascunhoStorage | null>(null);
  const rascunhoInicializado = useRef(false);

  // Restaura rascunho ao montar (uma vez, se não veio de lead)
  useEffect(() => {
    if (rascunhoInicializado.current) return;
    rascunhoInicializado.current = true;
    if (leadInicial) return; // lead tem prioridade sobre rascunho
    const r = lerRascunho();
    if (r) {
      setS1(r.s1);
      setS2(r.s2);
      setStep(r.step);
      setRascunhoRestaurado(r);
    }
  }, [leadInicial]);

  // Auto-save com debounce (só depois de inicializado)
  useEffect(() => {
    if (!rascunhoInicializado.current) return;
    const t = setTimeout(() => {
      const isEmpty = !s1.cedente_nome && !s1.numero_processo && !s2.valor_principal;
      if (isEmpty) return; // não polui localStorage com form vazio
      try {
        localStorage.setItem(
          RASCUNHO_KEY,
          JSON.stringify({ savedAt: Date.now(), s1, s2, step } satisfies RascunhoStorage),
        );
      } catch {
        // ignore quota/private mode
      }
    }, RASCUNHO_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [s1, s2, step]);

  function descartarRascunho() {
    if (!confirm('Descartar rascunho e começar do zero?')) return;
    limparRascunho();
    setS1(initialStep1);
    setS2(initialStep2);
    setStep(1);
    setRascunhoRestaurado(null);
    setErros({});
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
      // Sucesso: limpa rascunho (action fez redirect)
      limparRascunho();
    });
  }

  return (
    <div>
      {rascunhoRestaurado && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <span>
            ✓ Rascunho restaurado ({fmtRascunhoIdade(rascunhoRestaurado.savedAt)}). Continue de onde
            parou.
          </span>
          <button
            type="button"
            onClick={descartarRascunho}
            className="shrink-0 text-xs text-emerald-700 underline hover:text-emerald-900"
          >
            Descartar rascunho
          </button>
        </div>
      )}

      <StepIndicator step={step} />

      {erroServer && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {erroServer}
        </div>
      )}

      {step === 1 && (
        <section className="grid grid-cols-2 gap-4">
          <FieldText
            label="Nome do cedente"
            value={s1.cedente_nome}
            onChange={(v) => updateS1('cedente_nome', v)}
            error={erros.cedente_nome}
            required
            className="col-span-2"
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
              label: `${e.uf ? `${e.nome} (${e.uf})` : e.nome}${
                e.situacao === 'regime_especial' ? '  ⚠️ REGIME ESPECIAL' : ''
              }`,
            }))}
            error={erros.ente_devedor_id}
            required
            disabled={!s1.esfera}
            hint={
              !s1.esfera
                ? 'Selecione a esfera primeiro'
                : entesFiltrados.find((e) => e.id === s1.ente_devedor_id)?.situacao ===
                    'regime_especial'
                  ? '⚠️ Este ente está em regime especial — RGT normalmente não opera. Só admin consegue salvar.'
                  : undefined
            }
          />
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
        </section>
      )}

      {step === 2 && (
        <section className="space-y-6">
          <div>
            <h3 className="mb-3 text-sm font-semibold text-neutral-700">Valores do cedente</h3>
            <div className="grid grid-cols-3 gap-4">
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
            <div className="mt-3 rounded-md bg-neutral-100 p-3 text-sm text-neutral-700">
              <strong>Valor total:</strong>{' '}
              {valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-neutral-700">Deduções</h3>
            <div className="grid grid-cols-2 gap-4">
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
                hint="100 = compra do crédito integral. <100 = compra parcial."
              />
            </div>

            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s2.pss_ativo}
                  onChange={(e) => updateS2('pss_ativo', e.target.checked)}
                  className="h-4 w-4"
                />
                <span title="PSS = contribuição previdenciária retida pelo tribunal. Marque se o precatório do cedente sofre desconto de PSS (comum em servidores públicos). Percentual típico: 11%.">
                  Ativar PSS (Plano de Seguridade Social)
                  <span className="ml-1 cursor-help text-neutral-400">ⓘ</span>
                </span>
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
                  className="h-4 w-4"
                />
                <span title="RRA = Rendimento Recebido Acumuladamente. Marque quando o crédito acumula meses de atraso (regime especial de IR). 0 meses = IR fixo 3%. >0 meses = tabela progressiva sobre valor dividido pelo número de meses.">
                  Ativar IR / RRA (Rendimento Recebido Acumuladamente)
                  <span className="ml-1 cursor-help text-neutral-400">ⓘ</span>
                </span>
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
          </div>

          <FieldTextarea
            label="Observações sobre o cedente"
            value={s2.observacoes}
            onChange={(v) => updateS2('observacoes', v)}
            hint="Opcional. Ex: procurador, urgência, contexto."
          />
        </section>
      )}

      {step === 3 && (
        <section className="space-y-6">
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-neutral-900">Documentos</h3>
            <p className="text-sm text-neutral-600">
              Após criar a operação, anexe o <strong>Ofício Requisitório</strong> e demais
              documentos na aba <em>Documentos</em> da tela de detalhe.
            </p>
          </div>

          <div className="rounded-md border border-neutral-200 p-4">
            <h3 className="mb-3 text-sm font-semibold text-neutral-900">Revisão</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <ReviewItem label="Cedente" value={s1.cedente_nome} />
              <ReviewItem label="CPF" value={s1.cedente_cpf} />
              <ReviewItem label="Nascimento" value={fmtDataBR(s1.cedente_data_nascimento)} />
              <ReviewItem
                label="Estado civil"
                value={ESTADOS_CIVIS.find((e) => e.value === s1.cedente_estado_civil)?.label ?? '—'}
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
                value={Number(s2.valor_principal.replace(',', '.') || 0).toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
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
              <ReviewItem label="Retenção honorários" value={`${s2.retencao_honorarios_pct}%`} />
              <ReviewItem label="Aquisição" value={`${s2.percentual_aquisicao}%`} />
              <ReviewItem
                label="Valor total"
                value={valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              />
            </dl>
          </div>

          <label
            className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm transition-colors ${
              aceite
                ? 'border-emerald-300 bg-emerald-50'
                : erros.aceite_termos
                  ? 'border-red-400 bg-red-50'
                  : 'border-amber-300 bg-amber-50'
            }`}
          >
            <input
              type="checkbox"
              checked={aceite}
              onChange={(e) => {
                setAceite(e.target.checked);
                setErros((prev) => ({ ...prev, aceite_termos: '' }));
              }}
              className="mt-0.5 h-4 w-4"
            />
            <span className="font-medium">
              Confirmo que os dados acima estão corretos e desejo enviar a solicitação de operação.
              {!aceite && <span className="ml-1 text-red-600">*</span>}
            </span>
          </label>
          {erros.aceite_termos && <p className="text-xs text-red-600">{erros.aceite_termos}</p>}
        </section>
      )}

      <div className="mt-8 flex items-center justify-between border-t border-neutral-200 pt-4">
        <button
          type="button"
          onClick={() => step > 1 && irPara((step - 1) as 1 | 2)}
          disabled={step === 1 || pending}
          className="rounded-md px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
        >
          ← Voltar
        </button>

        {step < 3 ? (
          <button
            type="button"
            onClick={() => irPara((step + 1) as 2 | 3)}
            disabled={pending}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Próximo →
          </button>
        ) : (
          <button
            type="button"
            onClick={submeter}
            disabled={pending || !aceite}
            title={!aceite ? 'Marque a confirmação acima primeiro' : undefined}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:opacity-100"
          >
            {pending ? 'Enviando…' : 'Enviar solicitação'}
          </button>
        )}
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const items = [
    { n: 1, label: 'Dados do ativo' },
    { n: 2, label: 'Valores e deduções' },
    { n: 3, label: 'Documentos e envio' },
  ];
  return (
    <ol className="mb-8 flex items-center gap-2">
      {items.map((item, i) => {
        const active = item.n === step;
        const done = item.n < step;
        return (
          <li key={item.n} className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                active
                  ? 'bg-neutral-900 text-white'
                  : done
                    ? 'bg-emerald-600 text-white'
                    : 'bg-neutral-200 text-neutral-500'
              }`}
            >
              {done ? '✓' : item.n}
            </span>
            <span
              className={`text-sm ${active ? 'font-medium text-neutral-900' : 'text-neutral-500'}`}
            >
              {item.label}
            </span>
            {i < items.length - 1 && <span className="mx-2 h-px w-8 bg-neutral-300" />}
          </li>
        );
      })}
    </ol>
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
  return (
    <label className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="text-xs font-medium text-neutral-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900 ${
          error ? 'border-red-400' : 'border-neutral-300'
        }`}
      />
      {error ? (
        <span className="text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="text-xs text-neutral-500">{hint}</span>
      ) : null}
    </label>
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
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 disabled:bg-neutral-100 disabled:text-neutral-400 ${
          error ? 'border-red-400' : 'border-neutral-300'
        }`}
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
    </label>
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
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-700">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className={`rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900 ${
          error ? 'border-red-400' : 'border-neutral-300'
        }`}
      />
      {error ? (
        <span className="text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="text-xs text-neutral-500">{hint}</span>
      ) : null}
    </label>
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
