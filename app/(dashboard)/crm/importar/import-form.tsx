'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Upload, AlertTriangle, CheckCircle, X, Copy, Ban, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionHero } from '@/components/ui/section-hero';
import { Spinner } from '@/components/ui/spinner';
import { ORIGEM_LEAD } from '@/lib/leads';
import {
  parsePlanilha,
  texto,
  type LinhaImport,
  type CampoImport,
  type ColunaDuplicada,
} from '@/lib/leads-import';
import {
  conferirPlanilha,
  importarPlanilha,
  type Conferencia,
  type Vinculo,
} from '../import-actions';

export type DonoOption = { id: string; nome: string | null };

const ROTULO: Record<CampoImport, string> = {
  nome: 'Nome',
  telefone: 'Telefone',
  email: 'E-mail',
  cpf_cnpj: 'CPF/CNPJ',
  numero_processo: 'Processo',
  valor_processo: 'Valor',
  valor_proposta_indicativa: 'Proposta',
  notas: 'Notas',
};

/**
 * Vínculo decide o que pode ser enviado pra pessoa depois, e por qual canal.
 * A escolha é obrigatória de propósito: sem ela, meses depois ninguém sabe
 * dizer por que cada lead foi contatado.
 */
const VINCULOS: { value: Vinculo; label: string; ajuda: string }[] = [
  {
    value: 'lead_frio',
    label: 'Não tem relação com a gente ainda',
    ajuda:
      'Nome veio de lista pública ou pesquisa. Exige avisar de onde saiu o dado e oferecer descadastro.',
  },
  {
    value: 'cliente_mandato_vigente',
    label: 'Já é cliente, com procuração vigente',
    ajuda: 'Comunicar sobre o processo dele é dever de informação, não abordagem comercial.',
  },
  {
    value: 'ex_cliente',
    label: 'Foi cliente, mas o caso já encerrou',
    ajuda: 'Mandato extinto. Tratar como quem não tem relação ativa.',
  },
  {
    value: 'opt_in',
    label: 'Pediu contato (formulário, indicação aceita)',
    ajuda: 'A pessoa autorizou. É o único caso em que WhatsApp de saída é tranquilo.',
  },
];

export function ImportForm({ donos }: { donos: DonoOption[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<LinhaImport[] | null>(null);
  const [camposDetectados, setCamposDetectados] = useState<CampoImport[]>([]);
  const [colunasIgnoradas, setColunasIgnoradas] = useState<string[]>([]);
  const [colunasSemCabecalho, setColunasSemCabecalho] = useState<string[]>([]);
  const [colunasDuplicadas, setColunasDuplicadas] = useState<ColunaDuplicada[]>([]);
  const [linhaCabecalho, setLinhaCabecalho] = useState(0);
  const [erroParse, setErroParse] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);

  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [incluirDup, setIncluirDup] = useState<Set<number>>(new Set());

  const [origem, setOrigem] = useState('importacao_planilha');
  const [vinculo, setVinculo] = useState<Vinculo>('lead_frio');
  const [donoId, setDonoId] = useState<string>('');
  const [lote, setLote] = useState('');
  const [fonte, setFonte] = useState('');

  const [pending, startTransition] = useTransition();

  function resetar() {
    setRows(null);
    setCamposDetectados([]);
    setColunasIgnoradas([]);
    setColunasSemCabecalho([]);
    setColunasDuplicadas([]);
    setLinhaCabecalho(0);
    setErroParse(null);
    setConferencia(null);
    setIncluirDup(new Set());
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    resetar();
    if (!f) return;

    setLendo(true);
    try {
      // xlsx pesa ~430KB — só carrega depois que o usuário escolhe o arquivo.
      // Mesmo padrão do importador do TRT19.
      const XLSX = await import('xlsx');
      const buf = new Uint8Array(await f.arrayBuffer());
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0] ?? ''];
      if (!sheet) {
        setErroParse('Arquivo sem planilha legível.');
        return;
      }

      const matriz: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: true,
        blankrows: true,
        defval: '',
      });

      const r = parsePlanilha(matriz);
      if (r.erro) {
        setErroParse(r.erro);
        return;
      }
      if (r.linhas.length === 0) {
        setErroParse('Cabeçalho encontrado, mas nenhuma linha com dados abaixo dele.');
        return;
      }
      setRows(r.linhas);
      setCamposDetectados(r.camposDetectados);
      setColunasIgnoradas(r.colunasIgnoradas);
      setColunasSemCabecalho(r.colunasSemCabecalho);
      setColunasDuplicadas(r.colunasDuplicadas);
      setLinhaCabecalho(r.linhaCabecalho);
      if (!lote) setLote(f.name.replace(/\.(xlsx|xls|csv)$/i, ''));
      if (!fonte) setFonte(f.name);
    } catch (err) {
      setErroParse(
        `Não consegui ler o arquivo: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLendo(false);
    }
  }

  function conferir() {
    if (!rows) return;
    startTransition(async () => {
      const res = await conferirPlanilha(rows);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setConferencia(res.data!);
      const { novas, duplicadas, invalidas } = res.data!;
      if (duplicadas > 0 || invalidas > 0) {
        toast.warning(`${novas} novas · ${duplicadas} já existem · ${invalidas} com problema`);
      } else {
        toast.success(`${novas} leads novos, nenhuma duplicata`);
      }
    });
  }

  function importar() {
    if (!rows || !conferencia) return;
    startTransition(async () => {
      const res = await importarPlanilha(rows, {
        origem,
        vinculo,
        donoId: donoId || null,
        lote,
        fonteReferencia: fonte,
        incluirDuplicadas: Array.from(incluirDup),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { criados, puladas, erros } = res.data!;
      toast.success(
        `${criados} lead${criados === 1 ? '' : 's'} importado${criados === 1 ? '' : 's'}` +
          (puladas > 0
            ? ` · ${puladas} duplicada${puladas === 1 ? '' : 's'} pulada${puladas === 1 ? '' : 's'}`
            : '') +
          (erros.length > 0 ? ` · ${erros.length} com problema` : ''),
        { duration: 8000, description: erros.slice(0, 3).join(' · ') || undefined },
      );
      router.push('/crm');
    });
  }

  function toggleDup(i: number) {
    const next = new Set(incluirDup);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setIncluirDup(next);
  }

  const total = rows?.length ?? 0;
  const preview = rows?.slice(0, 5) ?? [];
  const vaiImportar = conferencia ? conferencia.novas + incluirDup.size : 0;
  const duplicadas = conferencia?.linhas.filter((l) => l.duplicataDe) ?? [];
  const invalidas = conferencia?.linhas.filter((l) => l.erro) ?? [];

  return (
    <div>
      <SectionHero
        title="Importar leads em massa"
        subtitle="Excel ou CSV. O importador reconhece os nomes de coluna mais comuns — não precisa renomear nada."
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
                {lendo ? <Spinner /> : <Upload className="size-8 text-neutral-400" />}
                <div className="text-sm font-medium text-neutral-900">
                  {file ? file.name : 'Clique pra escolher a planilha'}
                </div>
                <div className="text-xs text-neutral-500">Excel (.xlsx, .xls) ou CSV</div>
                <input
                  id="file"
                  type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={onFileChange}
                  className="hidden"
                  disabled={pending || lendo}
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

          {rows && total > 0 && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>
                    2. Confira o que eu li ({total} linha{total === 1 ? '' : 's'})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(colunasIgnoradas.length > 0 ||
                    colunasSemCabecalho.length > 0 ||
                    colunasDuplicadas.length > 0) && (
                    <div className="mb-3 space-y-2">
                      {colunasIgnoradas.length > 0 && (
                        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                          <AlertTriangle className="size-4 shrink-0" />
                          <div>
                            <strong>Colunas que eu não reconheci</strong> e por isso não vão entrar:{' '}
                            {colunasIgnoradas.join(', ')}. Se alguma delas importa, me avise que eu
                            ensino o importador a ler.
                          </div>
                        </div>
                      )}

                      {colunasSemCabecalho.length > 0 && (
                        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                          <AlertTriangle className="size-4 shrink-0" />
                          <div>
                            <strong>
                              Coluna{colunasSemCabecalho.length === 1 ? '' : 's'}{' '}
                              {colunasSemCabecalho.join(', ')} tem dados mas não tem título
                            </strong>{' '}
                            na linha {linhaCabecalho} da planilha, então não sei o que é e não vou
                            importar. Se for dado que importa, põe um título na coluna.
                          </div>
                        </div>
                      )}

                      {colunasDuplicadas.length > 0 && (
                        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                          <AlertTriangle className="size-4 shrink-0" />
                          <div>
                            <strong>Duas colunas para a mesma coisa.</strong>{' '}
                            {colunasDuplicadas.map((c) => (
                              <span key={c.cabecalho}>
                                Usei &quot;{c.venceu}&quot; e ignorei &quot;{c.cabecalho}&quot; (as
                                duas viraram {ROTULO[c.campo]}).{' '}
                              </span>
                            ))}
                            Se escolhi errado, apague a coluna que não serve e suba de novo.
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-neutral-200 bg-neutral-50 text-xs tracking-wide text-neutral-500 uppercase">
                        <tr>
                          {camposDetectados.map((c) => (
                            <th key={c} className="px-3 py-2 text-left font-medium">
                              {ROTULO[c]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {preview.map((r, i) => (
                          <tr key={i}>
                            {camposDetectados.map((c) => (
                              <td
                                key={c}
                                className="max-w-[200px] truncate px-3 py-2 text-neutral-700"
                              >
                                {texto(r[c]) || <span className="text-neutral-400">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {total > 5 && (
                      <div className="mt-2 text-xs text-neutral-500">
                        + {total - 5} outras linhas
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>3. De onde veio e quem trabalha</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="lote">Nome do lote</Label>
                      <Input
                        id="lote"
                        value={lote}
                        onChange={(e) => setLote(e.target.value)}
                        placeholder="Ex: Precatórios TRT19 setembro"
                        disabled={pending}
                      />
                      <span className="text-[11px] text-neutral-500">
                        Pra você achar depois de qual planilha veio cada lead
                      </span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="dono">Quem vai trabalhar esses leads</Label>
                      <select
                        id="dono"
                        value={donoId}
                        onChange={(e) => setDonoId(e.target.value)}
                        disabled={pending}
                        className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-900"
                      >
                        <option value="">Sem dono (distribuo depois)</option>
                        {donos.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.nome ?? 'Sem nome'}
                          </option>
                        ))}
                      </select>
                      <span className="text-[11px] text-neutral-500">
                        Sem dono, os {total} caem no kanban sem responsável
                      </span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="origem">Origem</Label>
                      <select
                        id="origem"
                        value={origem}
                        onChange={(e) => setOrigem(e.target.value)}
                        disabled={pending}
                        className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-900"
                      >
                        <option value="importacao_planilha">Importação de planilha</option>
                        <option value="lista_processual">Lista processual (tribunal)</option>
                        {ORIGEM_LEAD.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="fonte">Fonte do dado</Label>
                      <Input
                        id="fonte"
                        value={fonte}
                        onChange={(e) => setFonte(e.target.value)}
                        placeholder="Ex: Lista pública TRT19"
                        disabled={pending}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="vinculo">Que relação a gente já tem com essas pessoas?</Label>
                    <select
                      id="vinculo"
                      value={vinculo}
                      onChange={(e) => setVinculo(e.target.value as Vinculo)}
                      disabled={pending}
                      className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-900"
                    >
                      {VINCULOS.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] text-neutral-500">
                      {VINCULOS.find((v) => v.value === vinculo)?.ajuda}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {!conferencia ? (
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => router.push('/crm')} disabled={pending}>
                    <X className="size-4" />
                    Cancelar
                  </Button>
                  <Button onClick={conferir} disabled={pending}>
                    {pending ? (
                      <>
                        <Spinner />
                        Conferindo…
                      </>
                    ) : (
                      <>
                        <ArrowRight className="size-4" />
                        Conferir antes de importar
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>4. Resultado da conferência</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                          <div className="text-2xl font-semibold text-emerald-700">
                            {conferencia.novas}
                          </div>
                          <div className="text-xs text-emerald-800">novas</div>
                        </div>
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                          <div className="text-2xl font-semibold text-amber-700">
                            {conferencia.duplicadas}
                          </div>
                          <div className="text-xs text-amber-800">já existem</div>
                        </div>
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                          <div className="text-2xl font-semibold text-red-700">
                            {conferencia.invalidas}
                          </div>
                          <div className="text-xs text-red-800">com problema</div>
                        </div>
                      </div>

                      {duplicadas.length > 0 && (
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-neutral-700">
                            <Copy className="size-3.5" />
                            Já existem no sistema — marque se quiser importar mesmo assim
                          </div>
                          <div className="max-h-56 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
                            {duplicadas.map((l) => (
                              <label
                                key={l.indice}
                                className="flex cursor-pointer items-start gap-2 px-3 py-2 text-xs hover:bg-neutral-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={incluirDup.has(l.indice)}
                                  onChange={() => toggleDup(l.indice)}
                                  disabled={pending}
                                  className="mt-0.5"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium text-neutral-900">{l.nome}</div>
                                  <div className="text-neutral-500">{l.duplicataDe?.motivo}</div>
                                </div>
                                <span
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                                    l.duplicataDe?.origem === 'prospeccao'
                                      ? 'bg-blue-100 text-blue-700'
                                      : l.duplicataDe?.origem === 'planilha'
                                        ? 'bg-violet-100 text-violet-700'
                                        : 'bg-neutral-100 text-neutral-600'
                                  }`}
                                >
                                  {l.duplicataDe?.origem === 'prospeccao'
                                    ? 'prospecção'
                                    : l.duplicataDe?.origem === 'planilha'
                                      ? 'repetida'
                                      : 'CRM'}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {invalidas.length > 0 && (
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-neutral-700">
                            <Ban className="size-3.5" />
                            Não vão entrar — precisa corrigir na planilha
                          </div>
                          <div className="max-h-40 divide-y divide-red-100 overflow-y-auto rounded-md border border-red-200">
                            {invalidas.map((l) => (
                              <div key={l.indice} className="px-3 py-2 text-xs">
                                <span className="font-medium text-neutral-900">
                                  Linha {l.linhaOrigem}
                                </span>
                                {l.nome !== '(sem nome)' && (
                                  <span className="text-neutral-600"> · {l.nome}</span>
                                )}
                                <span className="text-red-700"> — {l.erro}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <div className="flex items-center justify-between gap-2">
                    <Button variant="ghost" onClick={() => setConferencia(null)} disabled={pending}>
                      Voltar
                    </Button>
                    <Button
                      onClick={importar}
                      disabled={pending || vaiImportar === 0}
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
                          Importar {vaiImportar} lead{vaiImportar === 1 ? '' : 's'}
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
                Colunas que eu reconheço
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-neutral-600">
                Não precisa renomear nada na sua planilha. Eu entendo variações:
              </p>
              <ul className="mt-2 space-y-1.5 text-xs text-neutral-700">
                <li>
                  <strong>Nome</strong> — Nome Completo, Cliente, Credor, Parte, Exequente
                </li>
                <li>
                  <strong>Telefone</strong> — Celular, WhatsApp, Contato, Fone
                </li>
                <li>
                  <strong>E-mail</strong>
                </li>
                <li>
                  <strong>CPF/CNPJ</strong> — Documento
                </li>
                <li>
                  <strong>Processo</strong> — Nº do Processo, CNJ
                </li>
                <li>
                  <strong>Valor</strong> — Valor do Processo, Valor da Causa, Valor de Face
                </li>
                <li>
                  <strong>Proposta</strong> — Eventual Proposta, Oferta
                </li>
                <li>
                  <strong>Notas</strong> — Observações, Obs
                </li>
              </ul>
              <p className="mt-3 text-xs text-neutral-500">
                Só a coluna de nome é obrigatória. Valor pode vir como R$ 187.430,00 que eu entendo.
                Coluna que eu não reconhecer aparece avisada na tela, não some calada.
              </p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
                Importar não é abordar
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-neutral-600">
                Subir a planilha só organiza os contatos aqui dentro. Ninguém recebe mensagem por
                causa disso — o contato é um passo separado, feito por uma pessoa, um de cada vez.
              </p>
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
                <li>Máximo 1000 linhas por vez</li>
                <li>Todos entram como &quot;Novo&quot;</li>
                <li>Cabeçalho pode estar em qualquer uma das 10 primeiras linhas</li>
                <li>Linha repetida na própria planilha é detectada</li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
