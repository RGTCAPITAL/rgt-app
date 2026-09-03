'use client';

import { useRef, useState, useTransition } from 'react';
import { uploadDocumento, deletarDocumento, getSignedUrl } from './documentos-actions';
import {
  GRUPOS,
  TIPOS_DOCUMENTO,
  labelTipoDoc,
  tiposObrigatorios,
  avisosCedente,
  type TipoDocumento,
  type ContextoCedente,
} from '@/lib/documentos-checklist';

export type Documento = {
  id: string;
  tipo: string;
  nome_original: string;
  storage_path: string;
  tamanho_bytes: number | null;
  uploaded_at: string;
  uploaded_by: string | null;
  uploader: { nome: string | null } | null;
};

import { JuditCard } from './judit-card';
import type { RedFlag } from '@/lib/judit/types';

type Props = {
  operacaoId: string;
  tipoAtivo: string;
  ctxCedente?: ContextoCedente;
  usuarioAtualId: string;
  isAdmin: boolean;
  documentos: Documento[];
  juditProps: {
    numeroProcesso: string;
    atualizadoEm: string | null;
    redFlags: RedFlag[];
    juditConfigurada: boolean;
  };
};

function fmtTamanho(b: number | null): string {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function TabDocumentos({
  operacaoId,
  tipoAtivo,
  ctxCedente,
  usuarioAtualId,
  isAdmin,
  documentos,
  juditProps,
}: Props) {
  const obrigatorios = new Set(tiposObrigatorios(tipoAtivo, ctxCedente));
  const avisos = avisosCedente(ctxCedente);
  const [erro, setErro] = useState<string | null>(null);

  // Agrupa documentos existentes por tipo (várias versões possíveis do mesmo tipo)
  const porTipo = new Map<string, Documento[]>();
  for (const doc of documentos) {
    const arr = porTipo.get(doc.tipo) ?? [];
    arr.push(doc);
    porTipo.set(doc.tipo, arr);
  }

  const enviados = documentos.length;
  const totalObrig = obrigatorios.size;
  const enviadosObrig = [...obrigatorios].filter((t) => porTipo.has(t)).length;

  return (
    <div className="space-y-6">
      <JuditCard operacaoId={operacaoId} {...juditProps} />

      <div className="flex items-center justify-between rounded-md bg-neutral-50 p-3 text-sm">
        <div>
          <strong className="text-neutral-900">{enviados}</strong>
          <span className="text-neutral-600">
            {' '}
            documento{enviados === 1 ? '' : 's'} enviado{enviados === 1 ? '' : 's'}
          </span>
          <span className="mx-2 text-neutral-400">·</span>
          <strong className="text-neutral-900">
            {enviadosObrig}/{totalObrig}
          </strong>
          <span className="text-neutral-600"> obrigatórios completos</span>
        </div>
        {enviadosObrig === totalObrig && totalObrig > 0 && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            ✓ Checklist completo
          </span>
        )}
      </div>

      {avisos.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <ul className="space-y-1">
            {avisos.map((a) => (
              <li key={a}>⚠️ {a}</li>
            ))}
          </ul>
        </div>
      )}

      {erro && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {erro}
        </div>
      )}

      {GRUPOS.map((grupo) => (
        <section key={grupo.key}>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            {grupo.label}
          </h3>
          <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {TIPOS_DOCUMENTO.filter((t) => t.grupo === grupo.key).map((td) => (
              <ItemChecklist
                key={td.value}
                operacaoId={operacaoId}
                tipo={td.value}
                label={td.label}
                obrigatorio={obrigatorios.has(td.value)}
                docsExistentes={porTipo.get(td.value) ?? []}
                usuarioAtualId={usuarioAtualId}
                isAdmin={isAdmin}
                onErro={setErro}
              />
            ))}
          </ul>
        </section>
      ))}

      <p className="text-xs text-neutral-500">
        Máximo 20MB por arquivo. Formatos aceitos: PDF, PNG, JPG, DOCX. Downloads geram link
        temporário de 60 segundos.
      </p>
    </div>
  );
}

function ItemChecklist({
  operacaoId,
  tipo,
  label,
  obrigatorio,
  docsExistentes,
  usuarioAtualId,
  isAdmin,
  onErro,
}: {
  operacaoId: string;
  tipo: TipoDocumento;
  label: string;
  obrigatorio: boolean;
  docsExistentes: Documento[];
  usuarioAtualId: string;
  isAdmin: boolean;
  onErro: (msg: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const temDoc = docsExistentes.length > 0;

  function abrirSeletor() {
    inputRef.current?.click();
  }

  function enviar(file: File) {
    onErro(null);
    const fd = new FormData();
    fd.append('operacao_id', operacaoId);
    fd.append('tipo', tipo);
    fd.append('file', file);
    startTransition(async () => {
      const res = await uploadDocumento(fd);
      if (!res.ok) onErro(res.error);
      if (inputRef.current) inputRef.current.value = '';
    });
  }

  function baixar(storagePath: string) {
    onErro(null);
    startTransition(async () => {
      const res = await getSignedUrl(storagePath);
      if (!res.ok) {
        onErro(res.error);
        return;
      }
      if (res.data?.url) window.open(res.data.url, '_blank');
    });
  }

  function apagar(id: string) {
    if (!confirm('Apagar este documento?')) return;
    onErro(null);
    startTransition(async () => {
      const res = await deletarDocumento(operacaoId, id);
      if (!res.ok) onErro(res.error);
    });
  }

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`h-2 w-2 rounded-full ${
                temDoc ? 'bg-emerald-500' : obrigatorio ? 'bg-amber-400' : 'bg-neutral-300'
              }`}
            />
            <span className="font-medium text-neutral-900">{label}</span>
            {obrigatorio && !temDoc && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                obrigatório
              </span>
            )}
            {temDoc && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                enviado
              </span>
            )}
          </div>
          {docsExistentes.length > 0 && (
            <ul className="mt-2 space-y-1 pl-4">
              {docsExistentes.map((d) => {
                const podeApagar = isAdmin || d.uploaded_by === usuarioAtualId;
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <button
                      type="button"
                      onClick={() => baixar(d.storage_path)}
                      disabled={pending}
                      className="text-neutral-700 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900 disabled:opacity-40"
                    >
                      {d.nome_original}
                    </button>
                    <span className="text-neutral-500">{fmtTamanho(d.tamanho_bytes)}</span>
                    <span className="text-neutral-500">
                      · por {d.uploader?.nome ?? 'usuário removido'}
                    </span>
                    {podeApagar && (
                      <button
                        type="button"
                        onClick={() => apagar(d.id)}
                        disabled={pending}
                        className="text-neutral-500 hover:text-red-600 disabled:opacity-40"
                      >
                        apagar
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) enviar(f);
            }}
            accept=".pdf,.png,.jpg,.jpeg,.docx,.doc"
          />
          <button
            type="button"
            onClick={abrirSeletor}
            disabled={pending}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
          >
            {temDoc ? 'Enviar outra versão' : 'Enviar'}
          </button>
        </div>
      </div>
    </li>
  );
}
