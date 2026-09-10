'use client';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FileUp, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { extrairDoOficio } from './ia-actions';
import type { CampoRevisao, RevisaoOficio } from '@/lib/ia/resolver';
import type { Confianca } from '@/lib/ia/schema';
import { cn } from '@/lib/utils';

type Props = {
  iaConfigurada: boolean;
  /** Merge no estado do passo correspondente. Devolve as chaves realmente aplicadas. */
  onAplicar: (passo: 1 | 2, patch: Record<string, string | boolean>) => void;
};

const CONFIANCA_UI: Record<Confianca, { label: string; classe: string }> = {
  alta: { label: 'alta', classe: 'bg-emerald-100 text-emerald-800' },
  media: { label: 'média', classe: 'bg-amber-100 text-amber-800' },
  baixa: { label: 'baixa', classe: 'bg-red-100 text-red-800' },
};

export function UploadOficio({ iaConfigurada, onAplicar }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [revisao, setRevisao] = useState<RevisaoOficio | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [aplicados, setAplicados] = useState<Set<string>>(new Set());
  const [conferiuValores, setConferiuValores] = useState(false);

  function enviar(file: File) {
    setRevisao(null);
    setAplicados(new Set());
    setConferiuValores(false);
    setNomeArquivo(file.name);

    const fd = new FormData();
    fd.append('file', file);

    startTransition(async () => {
      const res = await extrairDoOficio(fd);
      if (inputRef.current) inputRef.current.value = '';
      if (!res.ok) {
        toast.error(res.error);
        setNomeArquivo(null);
        return;
      }
      setRevisao(res.revisao);
      toast.success(`${res.revisao.campos.length} campos encontrados no documento`, {
        description: 'Confira cada um antes de aplicar — a IA lê, você decide.',
      });
    });
  }

  function aplicar(campos: CampoRevisao[]) {
    if (campos.length === 0) return;
    // Aplica passo a passo, mas num merge só por passo: mudar a esfera limpa
    // tribunal e ente devedor no formulário, então patch fatiado se perderia.
    for (const passo of [1, 2] as const) {
      const doPasso = campos.filter((c) => c.passo === passo);
      if (doPasso.length === 0) continue;
      const patch = Object.assign({}, ...doPasso.map((c) => c.patch));
      onAplicar(passo, patch);
    }
    setAplicados((prev) => {
      const next = new Set(prev);
      for (const c of campos) next.add(c.id);
      return next;
    });
  }

  function descartar() {
    setRevisao(null);
    setNomeArquivo(null);
    setAplicados(new Set());
    setConferiuValores(false);
  }

  if (!iaConfigurada) {
    return (
      <div className="mb-4 rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-600">
        <div className="flex items-center gap-2 font-medium text-neutral-800">
          <Sparkles className="size-4" />
          Preenchimento automático pelo ofício
        </div>
        <p className="mt-1">
          Indisponível: falta configurar <code className="text-xs">ANTHROPIC_API_KEY</code> no
          ambiente. Enquanto isso, preencha o formulário normalmente.
        </p>
      </div>
    );
  }

  const dados = revisao?.campos.filter((c) => !c.monetario) ?? [];
  const valores = revisao?.campos.filter((c) => c.monetario) ?? [];
  const pendentes = (lista: CampoRevisao[]) => lista.filter((c) => !aplicados.has(c.id));

  return (
    <div className="mb-4 rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-neutral-900">
            <Sparkles className="size-4" />
            Preenchimento automático pelo ofício
          </div>
          <p className="mt-1 text-xs text-neutral-600">
            {nomeArquivo && !pending
              ? nomeArquivo
              : 'Suba o PDF do ofício requisitório e a IA propõe o preenchimento. Nada é salvo sem sua revisão.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {revisao && (
            <Button type="button" variant="ghost" size="sm" onClick={descartar}>
              <X className="size-4" />
              Descartar leitura
            </Button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) enviar(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            {pending ? <Spinner size={4} /> : <FileUp className="size-4" />}
            {pending ? 'Lendo o documento…' : revisao ? 'Trocar arquivo' : 'Enviar ofício (PDF)'}
          </Button>
        </div>
      </div>

      {pending && (
        <p className="mt-3 text-xs text-neutral-500">
          A IA está lendo página por página. Ofício escaneado leva mais tempo — até um minuto.
        </p>
      )}

      {revisao && (
        <div className="mt-4 space-y-4">
          {revisao.avisos.length > 0 && (
            <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              {revisao.avisos.map((a) => (
                <li key={a}>⚠️ {a}</li>
              ))}
            </ul>
          )}

          {dados.length > 0 && (
            <BlocoCampos
              titulo="Dados do processo e do cedente"
              campos={dados}
              aplicados={aplicados}
              onAplicarUm={(c) => aplicar([c])}
              acao={
                <Button
                  type="button"
                  size="sm"
                  disabled={pendentes(dados).length === 0}
                  onClick={() => aplicar(pendentes(dados))}
                >
                  Aplicar {pendentes(dados).length || ''} campos
                </Button>
              }
            />
          )}

          {valores.length > 0 && (
            <BlocoCampos
              titulo="Valores"
              destaque
              campos={valores}
              aplicados={aplicados}
              onAplicarUm={(c) => aplicar([c])}
              acao={
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {/* Errar um valor aqui custa dinheiro. O botão em massa só
                      destrava depois que alguém afirma ter conferido no PDF. */}
                  <label className="flex items-center gap-2 text-xs text-neutral-700">
                    <input
                      type="checkbox"
                      checked={conferiuValores}
                      onChange={(e) => setConferiuValores(e.target.checked)}
                      className="size-3.5 accent-neutral-900"
                    />
                    Conferi os valores no PDF
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!conferiuValores || pendentes(valores).length === 0}
                    onClick={() => aplicar(pendentes(valores))}
                  >
                    Aplicar valores
                  </Button>
                </div>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function BlocoCampos({
  titulo,
  campos,
  aplicados,
  onAplicarUm,
  acao,
  destaque,
}: {
  titulo: string;
  campos: CampoRevisao[];
  aplicados: Set<string>;
  onAplicarUm: (c: CampoRevisao) => void;
  acao: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <section
      className={cn(
        'rounded-md border bg-white',
        destaque ? 'border-amber-300' : 'border-neutral-200',
      )}
    >
      <header
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2',
          destaque ? 'border-amber-200 bg-amber-50/60' : 'border-neutral-100',
        )}
      >
        <h4 className="text-xs font-semibold tracking-wide text-neutral-700 uppercase">{titulo}</h4>
        {acao}
      </header>
      <ul className="divide-y divide-neutral-100">
        {campos.map((c) => {
          const foiAplicado = aplicados.has(c.id);
          const conf = CONFIANCA_UI[c.confianca];
          return (
            <li key={c.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-neutral-500">{c.label}</span>
                  <strong className="text-neutral-900">{c.valorExibido}</strong>
                  <span
                    className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', conf.classe)}
                  >
                    confiança {conf.label}
                  </span>
                </div>
                {c.trecho && (
                  <p className="mt-0.5 truncate text-xs text-neutral-500 italic">“{c.trecho}”</p>
                )}
              </div>
              {foiAplicado ? (
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                  ✓ aplicado
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onAplicarUm(c)}
                  className="text-xs text-neutral-700 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900"
                >
                  aplicar
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
