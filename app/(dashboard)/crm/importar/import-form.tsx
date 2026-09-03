'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { Upload, FileText, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { SectionHero } from '@/components/ui/section-hero';
import { Spinner } from '@/components/ui/spinner';
import { ORIGEM_LEAD } from '@/lib/leads';
import { importarLeadsBatch } from '../actions';

type Row = {
  nome?: string;
  telefone?: string;
  email?: string;
  cpf_cnpj?: string;
  notas?: string;
};

const COLUNAS_ACEITAS = ['nome', 'telefone', 'email', 'cpf_cnpj', 'notas'] as const;

export function ImportForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [origem, setOrigem] = useState<string>('outro');
  const [erroParse, setErroParse] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setRows(null);
    setErroParse(null);
    if (!f) return;

    Papa.parse<Row>(f, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: (result) => {
        // Valida se tem pelo menos coluna "nome"
        const cols = result.meta.fields ?? [];
        if (!cols.includes('nome')) {
          setErroParse(
            `Coluna "nome" obrigatória. Colunas encontradas: ${cols.join(', ') || '(nenhuma)'}`,
          );
          return;
        }
        // Filtra colunas conhecidas
        const cleanRows = result.data.map((r) => {
          const out: Row = {};
          for (const key of COLUNAS_ACEITAS) {
            const v = (r as Record<string, unknown>)[key];
            if (v !== undefined && v !== null) out[key] = String(v).trim();
          }
          return out;
        });
        setRows(cleanRows);
      },
      error: (err) => setErroParse(`Erro no CSV: ${err.message}`),
    });
  }

  function importar() {
    if (!rows) return;
    startTransition(async () => {
      const res = await importarLeadsBatch(
        rows.map((r) => ({ ...r, nome: r.nome ?? '' })),
        origem,
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { criados, erros } = res.data ?? { criados: 0, erros: [] };
      if (erros.length > 0) {
        toast.warning(
          `${criados} lead${criados === 1 ? '' : 's'} criado${criados === 1 ? '' : 's'} · ${erros.length} linha${erros.length === 1 ? '' : 's'} ignorada${erros.length === 1 ? '' : 's'}`,
          { description: erros.slice(0, 3).join(' · '), duration: 8000 },
        );
      } else {
        toast.success(
          `${criados} lead${criados === 1 ? '' : 's'} criado${criados === 1 ? '' : 's'} com sucesso`,
        );
      }
      router.push('/crm');
    });
  }

  const previewRows = rows?.slice(0, 5) ?? [];
  const totalRows = rows?.length ?? 0;

  return (
    <div>
      <SectionHero
        title="Importar leads em massa"
        subtitle="Suba um CSV com colunas: nome, telefone, email, cpf_cnpj, notas. Máx 1000 linhas."
        color="blue"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>1. Escolha o arquivo</CardTitle>
            </CardHeader>
            <CardContent>
              <label
                htmlFor="file"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 px-6 py-10 text-center transition-colors hover:border-blue-400 hover:bg-blue-50"
              >
                <Upload className="size-8 text-neutral-400" />
                <div className="text-sm font-medium text-neutral-900">
                  {file ? file.name : 'Clique pra escolher o CSV'}
                </div>
                <div className="text-xs text-neutral-500">
                  Formato: CSV com cabeçalho. UTF-8. Separador vírgula.
                </div>
                <input
                  id="file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onFileChange}
                  className="hidden"
                  disabled={pending}
                />
              </label>

              {erroParse && (
                <div className="mt-4 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <AlertTriangle className="size-4 shrink-0" />
                  {erroParse}
                </div>
              )}
            </CardContent>
          </Card>

          {rows && rows.length > 0 && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>
                    2. Preview ({totalRows} linha{totalRows === 1 ? '' : 's'} detectada
                    {totalRows === 1 ? '' : 's'})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-neutral-200 bg-neutral-50 text-xs tracking-wide text-neutral-500 uppercase">
                        <tr>
                          {COLUNAS_ACEITAS.map((c) => (
                            <th key={c} className="px-3 py-2 text-left font-medium">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {previewRows.map((r, i) => (
                          <tr key={i}>
                            {COLUNAS_ACEITAS.map((c) => (
                              <td
                                key={c}
                                className="max-w-[200px] truncate px-3 py-2 text-neutral-700"
                              >
                                {r[c] || <span className="text-neutral-400">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {totalRows > 5 && (
                      <div className="mt-2 text-xs text-neutral-500">
                        + {totalRows - 5} outras linhas serão importadas
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>3. Origem dos leads</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="origem">
                      Todos os {totalRows} leads serão marcados com esta origem
                    </Label>
                    <select
                      id="origem"
                      value={origem}
                      onChange={(e) => setOrigem(e.target.value)}
                      disabled={pending}
                      className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-900"
                    >
                      {ORIGEM_LEAD.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => router.push('/crm')} disabled={pending}>
                  <X className="size-4" />
                  Cancelar
                </Button>
                <Button
                  onClick={importar}
                  disabled={pending}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {pending ? (
                    <>
                      <Spinner />
                      Importando…
                    </>
                  ) : (
                    <>
                      <CheckCircle className="size-4" />
                      Importar {totalRows} lead{totalRows === 1 ? '' : 's'}
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>

        <aside className="space-y-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
                Formato esperado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-neutral-600">
                CSV com cabeçalho na primeira linha. Colunas aceitas:
              </p>
              <ul className="mt-2 space-y-1 text-xs text-neutral-700">
                <li>
                  <code className="rounded bg-neutral-100 px-1">nome</code> (obrigatório)
                </li>
                <li>
                  <code className="rounded bg-neutral-100 px-1">telefone</code>
                </li>
                <li>
                  <code className="rounded bg-neutral-100 px-1">email</code>
                </li>
                <li>
                  <code className="rounded bg-neutral-100 px-1">cpf_cnpj</code>
                </li>
                <li>
                  <code className="rounded bg-neutral-100 px-1">notas</code>
                </li>
              </ul>
              <p className="mt-3 text-xs text-neutral-500">
                Colunas extras são ignoradas. Linhas com nome vazio, telefone/CPF inválido ou email
                mal formado são puladas — você vê o resumo depois.
              </p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
                Exemplo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded bg-neutral-900 p-2 text-[10px] text-neutral-100">
                {`nome,telefone,email,cpf_cnpj,notas
João Silva,82999998888,joao@ex.com,12345678901,Precatório TRT19
Maria Santos,82988887777,,,`}
              </pre>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xs font-medium tracking-wide text-neutral-500 uppercase">
                <FileText className="size-3.5" />
                Limites
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs text-neutral-600">
                <li>Máximo 1000 linhas por import</li>
                <li>Todos leads entram como status &quot;Novo&quot;</li>
                <li>Broker vira dono se você for broker</li>
                <li>Admin: leads ficam sem dono (distribui depois)</li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
