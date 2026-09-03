'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Upload, AlertTriangle, CheckCircle, X, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionHero } from '@/components/ui/section-hero';
import { Spinner } from '@/components/ui/spinner';
import { importarLoteProspeccao, type LinhaProspeccao } from '../actions';

/**
 * Layout TRT19 detectado:
 *   L1–L8: cabeçalho institucional
 *   L9: header ("Nº da RP", "Nº do Processo", "Nº do Precatório", "Tipo de Requisição",
 *               "Natureza do Crédito", "Valor", "Autuação", "Vencimento", "Esfera",
 *               "Ente Devedor", "Vara de Origem")
 *   L10+: dados
 *
 * Adaptável a outros layouts se precisar (TJAL, TRF5).
 */
function parseTRT19(sheet: XLSX.WorkSheet): {
  linhas: LinhaProspeccao[];
  erroLayout: string | null;
} {
  // Lê tudo como array de arrays a partir da linha do header
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });

  // Procura o header — normalmente é a linha com "Nº do Processo"
  let headerIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i];
    if (row?.some((c) => typeof c === 'string' && /n[ºo°]?\s*do\s*processo/i.test(String(c)))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      linhas: [],
      erroLayout: 'Não achei header com "Nº do Processo". Confirma se é planilha do TRT19?',
    };
  }

  const header = (aoa[headerIdx] ?? []).map((c) =>
    String(c ?? '')
      .toLowerCase()
      .trim(),
  );
  const col = {
    rp: header.findIndex((c) => c.includes('rp')),
    processo: header.findIndex((c) => c.includes('processo')),
    precatorio: header.findIndex((c) => c.includes('precat')),
    tipoReq: header.findIndex((c) => c.includes('requisi')),
    natureza: header.findIndex((c) => c.includes('natureza')),
    valor: header.findIndex((c) => c === 'valor' || c.startsWith('valor')),
    autuacao: header.findIndex((c) => c.includes('autua')),
    vencimento: header.findIndex((c) => c.includes('venciment')),
    esfera: header.findIndex((c) => c.includes('esfera')),
    ente: header.findIndex((c) => c.includes('ente')),
    vara: header.findIndex((c) => c.includes('vara')),
  };

  if (col.processo === -1) {
    return { linhas: [], erroLayout: 'Coluna "Nº do Processo" não encontrada.' };
  }

  const linhas: LinhaProspeccao[] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || r.every((c) => c === null || c === '')) continue;

    const processo = r[col.processo];
    if (!processo) continue;

    // Autuação: pode vir como Date (Excel serial) ou string dd/mm/yyyy
    let autuacaoIso: string | null = null;
    const autVal = col.autuacao !== -1 ? r[col.autuacao] : null;
    if (autVal instanceof Date) {
      autuacaoIso = autVal.toISOString().slice(0, 10);
    } else if (typeof autVal === 'string') {
      const m = autVal.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) autuacaoIso = `${m[3]}-${m[2]}-${m[1]}`;
    } else if (typeof autVal === 'number') {
      // Excel serial date
      const d = XLSX.SSF.parse_date_code(autVal);
      if (d) autuacaoIso = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }

    // Vencimento pode ser ano só ("2027") ou data
    let vencimentoAno: number | null = null;
    const vVal = col.vencimento !== -1 ? r[col.vencimento] : null;
    if (typeof vVal === 'number' && vVal >= 2000 && vVal <= 2100) {
      vencimentoAno = vVal;
    } else if (vVal instanceof Date) {
      vencimentoAno = vVal.getFullYear();
    } else if (typeof vVal === 'string') {
      const m = vVal.match(/(20\d{2})/);
      if (m) vencimentoAno = Number(m[1]);
    }

    const valorRaw = col.valor !== -1 ? r[col.valor] : null;
    const valor =
      typeof valorRaw === 'number'
        ? valorRaw
        : typeof valorRaw === 'string'
          ? Number(valorRaw.replace(/\./g, '').replace(',', '.')) || null
          : null;

    // Detecta tribunal pela vara ou natureza — TRT19 é o default aqui
    // (pode ser expandido futuramente)
    const tribunal = 'TRT19';

    linhas.push({
      numero_processo: String(processo),
      numero_precatorio: col.precatorio !== -1 ? (r[col.precatorio] as string | null) : null,
      numero_rp: col.rp !== -1 ? (r[col.rp] as string | null) : null,
      tribunal,
      esfera: col.esfera !== -1 ? (r[col.esfera] as string | null) : null,
      ente_devedor_nome: col.ente !== -1 ? (r[col.ente] as string | null) : null,
      natureza_credito: col.natureza !== -1 ? (r[col.natureza] as string | null) : null,
      tipo_requisicao: col.tipoReq !== -1 ? (r[col.tipoReq] as string | null) : null,
      valor_face: valor,
      autuacao_data: autuacaoIso,
      vencimento_ano: vencimentoAno,
      vara_origem: col.vara !== -1 ? (r[col.vara] as string | null) : null,
    });
  }

  return { linhas, erroLayout: null };
}

export function ImportForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<LinhaProspeccao[] | null>(null);
  const [fonteLote, setFonteLote] = useState<string>('trt19_venc_2027');
  const [erroParse, setErroParse] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setRows(null);
    setErroParse(null);
    if (!f) return;

    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]!];
      if (!sheet) {
        setErroParse('Planilha vazia.');
        return;
      }
      const { linhas, erroLayout } = parseTRT19(sheet);
      if (erroLayout) {
        setErroParse(erroLayout);
        return;
      }
      if (linhas.length === 0) {
        setErroParse('Nenhuma linha de dados encontrada após o header.');
        return;
      }
      setRows(linhas);
    } catch (err) {
      setErroParse(`Erro ao ler XLSX: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function importar() {
    if (!rows) return;
    startTransition(async () => {
      const res = await importarLoteProspeccao(rows, fonteLote);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { criados, ignorados, erros } = res.data;
      if (erros.length > 0 || ignorados > 0) {
        toast.warning(
          `${criados} nova${criados === 1 ? '' : 's'} · ${ignorados} já existia${ignorados === 1 ? '' : 'm'} · ${erros.length} erro${erros.length === 1 ? '' : 's'}`,
          { description: erros.slice(0, 3).join(' · '), duration: 8000 },
        );
      } else {
        toast.success(
          `${criados} precatório${criados === 1 ? '' : 's'} importado${criados === 1 ? '' : 's'}`,
        );
      }
      router.push('/admin/prospeccao');
    });
  }

  const previewRows = rows?.slice(0, 5) ?? [];
  const totalRows = rows?.length ?? 0;
  const somaValor = rows?.reduce((s, r) => s + (r.valor_face ?? 0), 0) ?? 0;

  return (
    <div>
      <SectionHero
        title="Importar planilha de prospecção"
        subtitle="Suba a lista oficial de precatórios do TRT/TJ. Vira fila pré-lead pro time comercial."
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
                  {file ? file.name : 'Clique pra escolher o XLSX'}
                </div>
                <div className="text-xs text-neutral-500">
                  Formato: planilha oficial do TRT19 (ex: &quot;Relação dos Precatórios com
                  Vencimento em 2027&quot;)
                </div>
                <input
                  id="file"
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
                    2. Preview ({totalRows} precatório{totalRows === 1 ? '' : 's'} · R${' '}
                    {somaValor.toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    )
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-neutral-200 bg-neutral-50 text-xs tracking-wide text-neutral-500 uppercase">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Nº Processo</th>
                          <th className="px-3 py-2 text-left font-medium">Valor</th>
                          <th className="px-3 py-2 text-left font-medium">Ente</th>
                          <th className="px-3 py-2 text-left font-medium">Venc</th>
                          <th className="px-3 py-2 text-left font-medium">Vara</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {previewRows.map((r, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 font-mono text-xs">{r.numero_processo}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {r.valor_face
                                ? `R$ ${r.valor_face.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                                : '—'}
                            </td>
                            <td className="px-3 py-2">{r.ente_devedor_nome || '—'}</td>
                            <td className="px-3 py-2">{r.vencimento_ano || '—'}</td>
                            <td className="max-w-[200px] truncate px-3 py-2 text-neutral-600">
                              {r.vara_origem || '—'}
                            </td>
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
                  <CardTitle>3. Nome do lote</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="lote">
                      Identificador único desse lote. Re-importar com o mesmo nome não duplica.
                    </Label>
                    <Input
                      id="lote"
                      value={fonteLote}
                      onChange={(e) => setFonteLote(e.target.value.toLowerCase())}
                      disabled={pending}
                      placeholder="trt19_venc_2027"
                      pattern="[a-z0-9_-]{3,60}"
                    />
                    <p className="text-xs text-neutral-500">
                      Padrão: <code>&lt;tribunal&gt;_venc_&lt;ano&gt;</code>. Minúsculas, dígitos,
                      hífen e underscore.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => router.push('/admin/prospeccao')}
                  disabled={pending}
                >
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
                      Importar {totalRows} precatório{totalRows === 1 ? '' : 's'}
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
              <CardTitle className="flex items-center gap-2 text-xs font-medium tracking-wide text-neutral-500 uppercase">
                <FileSpreadsheet className="size-3.5" />
                Como pegar a planilha
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-1.5 text-xs text-neutral-700">
                <li>
                  1. Vai no site do TRT19 → Precatórios → &quot;Relação de precatórios com
                  vencimento em &lt;ano&gt;&quot;
                </li>
                <li>2. Baixa o XLSX (não converte pra CSV)</li>
                <li>3. Sobe aqui — layout é detectado automaticamente</li>
              </ol>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
                Depois do import
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs text-neutral-600">
                <li>• Cada linha vira status &quot;importado&quot;</li>
                <li>• Rodar Judit em batch → status &quot;enriquecido&quot; com nome do credor</li>
                <li>• Broker pega da fila, busca contato, vira lead</li>
                <li>• Lead vira operação pelo fluxo normal do CRM</li>
              </ul>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
                Limites
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs text-neutral-600">
                <li>Máximo 5000 linhas por import</li>
                <li>Só admin e gestão importam</li>
                <li>Broker vê a fila, mas não importa</li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
