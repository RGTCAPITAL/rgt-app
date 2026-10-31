'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Eye, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { montarMensagem, VARIAVEIS_DISPONIVEIS } from '@/lib/crm/mensagem';
import { alternarAtivo, salvarModelo } from './actions';

export type ModeloRow = {
  id: string;
  nome: string;
  texto: string;
  requer_valor: boolean;
  requer_ente: boolean;
  uso: 'primeiro_contato' | 'retomada';
  ordem: number;
  ativo: boolean;
  updated_at: string;
};

/** Lead fictício só para a pré-visualização — deixa ver o texto já preenchido. */
const EXEMPLO = {
  nome: 'José Ribamar da Silva',
  valorProposta: 120000,
  valorProcesso: 187430,
  numeroProcesso: '0001107-33.2017.5.19.0001',
  enteDevedor: 'Estado de Alagoas',
};

const LIMITE = 1200;

export function ListaModelos({ modelos }: { modelos: ModeloRow[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [texto, setTexto] = useState('');
  const [pending, startTransition] = useTransition();

  function abrir(m: ModeloRow) {
    setEditando(m.id);
    setNome(m.nome);
    setTexto(m.texto);
  }

  function salvar(id: string) {
    startTransition(async () => {
      const res = await salvarModelo(id, nome, texto);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Modelo salvo');
      setEditando(null);
      router.refresh();
    });
  }

  function alternar(m: ModeloRow) {
    startTransition(async () => {
      const res = await alternarAtivo(m.id, !m.ativo);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(m.ativo ? 'Modelo desativado' : 'Modelo ativado');
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-xs text-neutral-600">
        <div className="mb-2 font-medium text-neutral-900">Como o sistema escolhe o texto</div>
        <p>
          Ao clicar no WhatsApp de um lead, o sistema usa o primeiro modelo ativo cujos dados aquele
          lead tem. Um lead sem valor cadastrado recebe a versão que não cita valor — assim a
          mensagem nunca sai com buraco.
        </p>
        <p className="mt-2">
          Lead que já saiu de Novo recebe o texto marcado “para lead já contatado”: é a retomada que
          o follow-up automático manda usar. Sem nenhum desses ativo, ele recebe o de primeiro
          contato.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {VARIAVEIS_DISPONIVEIS.map((v) => (
            <span key={v.chave}>
              <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[11px]">
                {v.chave}
              </code>
              <span className="ml-1.5 text-neutral-500">{v.descricao}</span>
            </span>
          ))}
        </div>
      </div>

      {modelos.map((m) => {
        const aberto = editando === m.id;
        const previa = montarMensagem(aberto ? texto : m.texto, EXEMPLO);
        const excedeu = texto.length > LIMITE;

        return (
          <Card key={m.id} className={m.ativo ? '' : 'opacity-60'}>
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {aberto ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`nome-${m.id}`}>Nome do modelo</Label>
                      <Input
                        id={`nome-${m.id}`}
                        value={nome}
                        onChange={(e) => setNome(e.target.value)}
                        disabled={pending}
                        className="w-72"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="text-sm font-semibold text-neutral-900">{m.nome}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-neutral-500">
                        {m.requer_valor && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5">
                            só para lead com valor
                          </span>
                        )}
                        {m.requer_ente && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5">
                            só para lead com devedor
                          </span>
                        )}
                        {m.uso === 'retomada' && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5">
                            para lead já contatado
                          </span>
                        )}
                        {!m.ativo && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                            desativado
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {!aberto && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => alternar(m)}
                      disabled={pending}
                    >
                      {m.ativo ? 'Desativar' : 'Ativar'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => abrir(m)}>
                      <Pencil className="size-3.5" />
                      Editar
                    </Button>
                  </div>
                )}
              </div>

              {aberto ? (
                <div className="space-y-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`texto-${m.id}`}>Texto</Label>
                    <Textarea
                      id={`texto-${m.id}`}
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                      rows={9}
                      disabled={pending}
                      className="font-mono text-xs"
                    />
                    <span
                      className={`text-[11px] ${excedeu ? 'font-medium text-red-600' : 'text-neutral-400'}`}
                    >
                      {texto.length} de {LIMITE} caracteres
                      {excedeu && ' — o WhatsApp corta mensagem longa no link'}
                    </span>
                  </div>

                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-blue-900">
                      <Eye className="size-3" />
                      Como fica para {EXEMPLO.nome}
                    </div>
                    <p className="text-xs whitespace-pre-wrap text-blue-900">{previa}</p>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditando(null)}
                      disabled={pending}
                    >
                      <X className="size-3.5" />
                      Cancelar
                    </Button>
                    <Button size="sm" onClick={() => salvar(m.id)} disabled={pending || excedeu}>
                      {pending ? <Spinner /> : <Check className="size-3.5" />}
                      Salvar
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs whitespace-pre-wrap text-neutral-600">{m.texto}</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
