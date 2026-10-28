'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Bot, RotateCcw, Send, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { MensagemHistorico, PlanoRobo } from '@/lib/whatsapp/robo/decidir';
import { ROTULO_DADO, valorDado, type DadosColetados } from '@/lib/whatsapp/robo/schema';
import type { UsoIA } from '@/lib/whatsapp/robo/claude';
import { simularRobo } from './actions';

type Passo = { plano: PlanoRobo; uso: UsoIA | null };

const FONTE: Record<PlanoRobo['fonte'], { rotulo: string; explica: string; cor: string }> = {
  freio_entrada: {
    rotulo: 'Freio de entrada',
    explica: 'O código respondeu sozinho. A IA nem viu a mensagem.',
    cor: 'bg-amber-100 text-amber-900',
  },
  ia: {
    rotulo: 'IA (Claude)',
    explica: 'A IA escreveu e o freio de saída aprovou.',
    cor: 'bg-blue-100 text-blue-900',
  },
  freio_saida: {
    rotulo: 'Freio de saída',
    explica: 'A IA escreveu algo proibido. O texto dela não saiu.',
    cor: 'bg-rose-100 text-rose-900',
  },
  erro_ia: {
    rotulo: 'Erro da IA',
    explica: 'A IA falhou. A pessoa recebeu a passagem pro broker.',
    cor: 'bg-rose-100 text-rose-900',
  },
};

const ABERTURA_FRIA =
  'Olá! Aqui é da RGT Capital. Vimos que você tem um processo com ofício requisitório expedido. Podemos conversar sobre ele?';

export function Simulador({ modelo }: { modelo: string }) {
  const [credor, setCredor] = useState('José Ribamar da Silva');
  const [tribunal, setTribunal] = useState('TJAL');
  const [devedor, setDevedor] = useState('Estado de Alagoas');
  const [idade, setIdade] = useState('');
  const [frio, setFrio] = useState(false);

  const [historico, setHistorico] = useState<MensagemHistorico[]>([]);
  const [fontes, setFontes] = useState<Record<number, PlanoRobo['fonte']>>({});
  const [recusasDePreco, setRecusasDePreco] = useState(0);
  const [naoEntendidas, setNaoEntendidas] = useState(0);
  const [ultimo, setUltimo] = useState<Passo | null>(null);
  const [dados, setDados] = useState<DadosColetados | null>(null);
  const [parou, setParou] = useState<{ motivo: string; urgente: boolean; optout: boolean } | null>(
    null,
  );
  const [custo, setCusto] = useState(0);
  const [texto, setTexto] = useState('');
  const [pending, startTransition] = useTransition();

  const comecou = historico.length > 0;

  function recomecar() {
    setHistorico([]);
    setFontes({});
    setRecusasDePreco(0);
    setNaoEntendidas(0);
    setUltimo(null);
    setDados(null);
    setParou(null);
    setCusto(0);
    setTexto('');
  }

  function enviar() {
    const conteudo = texto.trim();
    if (!conteudo || pending || parou) return;

    const base: MensagemHistorico[] =
      historico.length === 0 && frio ? [{ autor: 'humano', conteudo: ABERTURA_FRIA }] : historico;
    const comPessoa = [...base, { autor: 'contato' as const, conteudo }];
    setHistorico(comPessoa);
    setTexto('');

    startTransition(async () => {
      const r = await simularRobo({
        historico: comPessoa,
        ctx: {
          recusasDePreco,
          naoEntendidasSeguidas: naoEntendidas,
          idadeTitular: idade ? Number(idade) : null,
        },
        processo: {
          credor: credor || null,
          tribunal: tribunal || null,
          ente_devedor: devedor || null,
          numero_processo: null,
        },
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      const { plano, uso } = r;
      setUltimo({ plano, uso });
      if (plano.enviar) {
        setFontes((f) => ({ ...f, [comPessoa.length]: plano.fonte }));
        setHistorico([...comPessoa, { autor: 'bot', conteudo: plano.enviar }]);
      }
      if (plano.recusouPreco) setRecusasDePreco((n) => n + 1);
      setNaoEntendidas((n) => (plano.naoEntendeu ? n + 1 : 0));
      if (plano.dados) setDados(plano.dados);
      if (uso) setCusto((c) => c + uso.custoUsd);
      if (plano.pausar || plano.optout) {
        setParou({
          motivo: plano.pausar?.motivo ?? '',
          urgente: plano.pausar?.urgente ?? false,
          optout: plano.optout,
        });
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="flex min-h-[32rem] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-neutral-200 p-4 sm:grid-cols-2">
          <p className="text-xs text-neutral-500 sm:col-span-2">
            O que a RGT já sabe do processo. O robô apresenta isso e pede confirmação.
          </p>
          <Campo rotulo="Credor" valor={credor} onChange={setCredor} travado={comecou} />
          <Campo rotulo="Tribunal" valor={tribunal} onChange={setTribunal} travado={comecou} />
          <Campo rotulo="Devedor" valor={devedor} onChange={setDevedor} travado={comecou} />
          <Campo
            rotulo="Idade do titular (opcional)"
            valor={idade}
            onChange={(v) => setIdade(v.replace(/\D/g, '').slice(0, 3))}
            travado={comecou}
          />
          <label className="flex items-center gap-2 text-sm text-neutral-700 sm:col-span-2">
            <input
              type="checkbox"
              checked={frio}
              disabled={comecou}
              onChange={(e) => setFrio(e.target.checked)}
            />
            A RGT escreveu primeiro (contato frio, não veio do site)
          </label>
        </div>

        <ol className="flex flex-1 flex-col gap-2 overflow-y-auto bg-neutral-50 p-4">
          {!comecou && (
            <li className="m-auto max-w-sm text-center text-sm text-neutral-500">
              Escreva como se fosse o cliente. Tente perguntar o preço duas vezes, dizer que é
              golpe, ou contar que o titular faleceu.
            </li>
          )}
          {historico.map((m, i) => {
            const daRgt = m.autor !== 'contato';
            const fonte = fontes[i];
            return (
              <li
                key={i}
                className={cn('flex flex-col gap-0.5', daRgt ? 'items-end' : 'items-start')}
              >
                {daRgt && (
                  <span className="flex items-center gap-1 text-[11px] text-neutral-500">
                    {m.autor === 'bot' ? (
                      <Bot className="size-3" />
                    ) : (
                      <UserRound className="size-3" />
                    )}
                    {m.autor === 'bot' ? 'Robô' : 'Equipe RGT'}
                    {fonte && <span className="text-neutral-400">· {FONTE[fonte].rotulo}</span>}
                  </span>
                )}
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap shadow-sm',
                    daRgt ? 'bg-blue-50' : 'bg-white',
                    fonte && fonte !== 'ia' && 'ring-1 ring-amber-300',
                  )}
                >
                  {m.conteudo}
                </div>
              </li>
            );
          })}
          {pending && (
            <li className="flex items-center gap-2 self-end text-xs text-neutral-500">
              <Spinner /> o robô está pensando…
            </li>
          )}
        </ol>

        {parou ? (
          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm',
              parou.urgente
                ? 'border-rose-200 bg-rose-50 text-rose-900'
                : 'border-amber-200 bg-amber-50 text-amber-900',
            )}
          >
            <p>
              <span className="font-semibold">
                {parou.optout ? 'Pediu pra sair.' : 'O robô parou.'}
              </span>{' '}
              {parou.motivo}
              {!parou.optout && ' Numa conversa real, ela iria agora pro broker.'}
              {parou.urgente && ' Urgente: avisaria o Renato.'}
            </p>
            <Button size="sm" variant="outline" onClick={recomecar}>
              <RotateCcw className="size-3.5" /> Recomeçar
            </Button>
          </div>
        ) : (
          <form
            className="flex items-end gap-2 border-t border-neutral-200 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              enviar();
            }}
          >
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              rows={2}
              placeholder="Escreva como o cliente… (Enter envia, Shift+Enter quebra linha)"
              className="min-h-0 flex-1 resize-none"
              disabled={pending}
            />
            <Button type="submit" disabled={pending || !texto.trim()} aria-label="Enviar">
              {pending ? <Spinner /> : <Send className="size-4" />}
            </Button>
          </form>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        <Painel titulo="Última decisão">
          {ultimo ? (
            <div className="flex flex-col gap-2 text-sm">
              <span
                className={cn(
                  'w-fit rounded-full px-2 py-0.5 text-xs font-medium',
                  FONTE[ultimo.plano.fonte].cor,
                )}
              >
                {FONTE[ultimo.plano.fonte].rotulo}
              </span>
              <p className="text-neutral-600">{FONTE[ultimo.plano.fonte].explica}</p>
              {ultimo.plano.gatilho && (
                <p className="text-xs text-neutral-500">Gatilho: {ultimo.plano.gatilho}</p>
              )}
              {ultimo.uso && (
                <p className="text-xs text-neutral-500">
                  {ultimo.uso.entrada + ultimo.uso.cacheLeitura + ultimo.uso.cacheEscrita} tokens de
                  entrada ({ultimo.uso.cacheLeitura} do cache) · {ultimo.uso.saida} de saída · US${' '}
                  {ultimo.uso.custoUsd.toFixed(4)}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-500">Nada ainda.</p>
          )}
        </Painel>

        <Painel titulo="Dados anotados">
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            {(Object.keys(ROTULO_DADO) as (keyof DadosColetados)[]).map((k) => (
              <div key={k} className="contents">
                <dt className="text-neutral-600">{ROTULO_DADO[k]}</dt>
                <dd className="text-right font-medium text-neutral-900">
                  {valorDado(dados?.[k] ?? null)}
                </dd>
              </div>
            ))}
          </dl>
        </Painel>

        <Painel titulo="Custo desta conversa">
          <p className="text-2xl font-semibold text-neutral-900">US$ {custo.toFixed(4)}</p>
          <p className="text-xs text-neutral-500">
            Modelo {modelo}. Respostas do freio não custam nada.
          </p>
        </Painel>
      </aside>
    </div>
  );
}

function Campo({
  rotulo,
  valor,
  onChange,
  travado,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  travado: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-700">{rotulo}</span>
      <Input value={valor} onChange={(e) => onChange(e.target.value)} disabled={travado} />
    </label>
  );
}

function Painel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {titulo}
      </h2>
      {children}
    </section>
  );
}
