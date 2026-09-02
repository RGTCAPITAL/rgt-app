'use client';

import { useState, useTransition } from 'react';
import { criarLead, atualizarLead } from './actions';
import { ORIGEM_LEAD, STATUS_LEAD } from '@/lib/leads';

export type DonoOption = { id: string; nome: string | null };

export type LeadEdit = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  cpf_cnpj: string | null;
  origem: string;
  dono_id: string | null;
  notas: string | null;
  status: string;
  operacao_id: string | null;
  motivo_perda: string | null;
};

type Props = {
  aberto: boolean;
  onClose: () => void;
  donos: DonoOption[];
  meuId: string;
  isAdmin: boolean;
  editando?: LeadEdit;  // se passado, é edição; senão criação
};

function fmtTelefone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 13);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
}

function fmtCpfCnpj(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  if (d.length <= 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  // CNPJ 00.000.000/0000-00
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function LeadForm({ aberto, onClose, donos, meuId, isAdmin, editando }: Props) {
  const [nome, setNome] = useState(editando?.nome ?? '');
  const [telefone, setTelefone] = useState(fmtTelefone(editando?.telefone ?? ''));
  const [email, setEmail] = useState(editando?.email ?? '');
  const [cpfCnpj, setCpfCnpj] = useState(fmtCpfCnpj(editando?.cpf_cnpj ?? ''));
  const [origem, setOrigem] = useState<string>(editando?.origem ?? '');
  const [donoId, setDonoId] = useState(editando?.dono_id ?? (isAdmin ? '' : meuId));
  const [notas, setNotas] = useState(editando?.notas ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!aberto) return null;

  function salvar() {
    setErro(null);
    if (!nome.trim() || !origem) {
      setErro('Nome e origem são obrigatórios.');
      return;
    }
    const payload = {
      nome: nome.trim(),
      telefone,
      email: email.trim(),
      cpf_cnpj: cpfCnpj,
      origem,
      dono_id: donoId,
      notas: notas.trim(),
    };

    startTransition(async () => {
      const res = editando
        ? await atualizarLead(editando.id, payload)
        : await criarLead(payload);
      if (!res.ok) {
        setErro(res.error);
        return;
      }
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
      onClick={() => !pending && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-md border border-neutral-200 bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-neutral-900">
          {editando ? 'Editar lead' : 'Novo lead'}
        </h2>

        {editando && <StatusVinculo lead={editando} />}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Nome *" full>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              disabled={pending}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
              autoFocus
            />
          </Field>
          <Field label="Telefone">
            <input
              value={telefone}
              onChange={(e) => setTelefone(fmtTelefone(e.target.value))}
              disabled={pending}
              placeholder="(82) 99123-4567"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </Field>
          <Field label="CPF / CNPJ">
            <input
              value={cpfCnpj}
              onChange={(e) => setCpfCnpj(fmtCpfCnpj(e.target.value))}
              disabled={pending}
              placeholder="000.000.000-00"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </Field>
          <Field label="Origem *">
            <select
              value={origem}
              onChange={(e) => setOrigem(e.target.value)}
              disabled={pending}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
            >
              <option value="">Selecione…</option>
              {ORIGEM_LEAD.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {isAdmin && (
            <Field label="Dono">
              <select
                value={donoId}
                onChange={(e) => setDonoId(e.target.value)}
                disabled={pending}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
              >
                <option value="">— sem dono —</option>
                {donos.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nome ?? '—'}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Notas" full>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              disabled={pending}
              placeholder="Contexto: como surgiu, o que tem, próximos passos"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </Field>
        </div>

        {erro && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            {erro}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={pending || !nome.trim() || !origem}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            {pending ? 'Salvando…' : editando ? 'Salvar alterações' : 'Criar lead'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${full ? 'col-span-2' : ''}`}>
      <span className="text-xs font-medium text-neutral-700">{label}</span>
      {children}
    </label>
  );
}

function StatusVinculo({ lead }: { lead: LeadEdit }) {
  const stat = STATUS_LEAD.find((s) => s.value === lead.status);
  const podeConverter = lead.status === 'qualificado' || lead.status === 'proposta_enviada';
  const jaGanho = lead.status === 'ganho' && lead.operacao_id;
  const perdido = lead.status === 'perdido' && lead.motivo_perda;

  function converter(e: React.MouseEvent) {
    if (!confirm(`Converter "${lead.nome}" em operação? Você será levado ao formulário com os dados pré-preenchidos.`)) {
      e.preventDefault();
    }
  }

  return (
    <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Status:</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stat?.cor ?? 'bg-neutral-100 text-neutral-700'}`}>
            {stat?.label ?? lead.status}
          </span>
        </div>
        {podeConverter && (
          <a
            href={`/operacoes/nova?lead_id=${lead.id}`}
            onClick={converter}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            → Virar operação
          </a>
        )}
        {jaGanho && (
          <a
            href={`/operacoes/${lead.operacao_id}`}
            className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
          >
            → Ver operação vinculada
          </a>
        )}
      </div>
      {perdido && (
        <p className="mt-2 border-l-2 border-red-300 pl-2 text-xs italic text-neutral-600">
          Motivo: {lead.motivo_perda}
        </p>
      )}
    </div>
  );
}
