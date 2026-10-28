'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { MODELOS, montarTextoModelo, type Destino } from '@/lib/whatsapp/modelos';
import { dadosParaDisparo, dispararModelo, type DadosDisparo } from './disparo-actions';

/**
 * Abordar um lead pelo WhatsApp da RGT, com o modelo aprovado pela Meta.
 *
 * Diferente do ícone verde do card (wa.me), que abre o WhatsApp do próprio
 * broker: aqui a mensagem sai do número da empresa, fica registrada na tela de
 * Conversas e a resposta chega pra todos que acompanham o lead.
 *
 * Regra do Renato (28/10): onde há advogado nos autos, o advogado primeiro.
 * Por isso, quando o processo tem advogado, a janela já abre nele.
 */
export function DialogDisparo({
  lead,
  onFechar,
}: {
  lead: { id: string; nome: string } | null;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [dados, setDados] = useState<DadosDisparo | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [destino, setDestino] = useState<Destino>('credor');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!lead) return;
    let vivo = true;
    dadosParaDisparo(lead.id).then((r) => {
      if (!vivo) return;
      if (!r.ok) {
        setErroCarga(r.error);
        return;
      }
      setErroCarga(null);
      setDados(r.dados);
      const inicio: Destino = r.dados.advogadoNome ? 'advogado' : 'credor';
      setDestino(inicio);
      setNome(inicio === 'advogado' ? (r.dados.advogadoNome ?? '') : r.dados.credorNome);
      setTelefone(inicio === 'advogado' ? '' : (r.dados.credorTelefone ?? ''));
    });
    return () => {
      vivo = false;
    };
  }, [lead]);

  function trocarDestino(d: Destino) {
    if (!dados) return;
    setDestino(d);
    setNome(d === 'advogado' ? (dados.advogadoNome ?? '') : dados.credorNome);
    setTelefone(d === 'advogado' ? '' : (dados.credorTelefone ?? ''));
  }

  function fechar() {
    setDados(null);
    setErroCarga(null);
    onFechar();
  }

  function enviar() {
    if (!lead) return;
    startTransition(async () => {
      const r = await dispararModelo({
        leadId: lead.id,
        destino,
        nomeDestinatario: nome,
        telefone,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success('Mensagem enviada. A resposta vai aparecer em Conversas.', {
        action: { label: 'Abrir', onClick: () => router.push(`/conversas?c=${r.conversaId}`) },
      });
      fechar();
      router.refresh();
    });
  }

  const previa = dados?.numeroProcesso
    ? montarTextoModelo(destino, [nome || '…', '[seu nome]', dados.numeroProcesso])
    : null;

  const bloqueio = !dados
    ? null
    : !dados.whatsappConectado
      ? 'O número da RGT ainda não está conectado ao WhatsApp.'
      : !dados.numeroProcesso
        ? 'O lead precisa do número do processo: ele vai na mensagem.'
        : null;

  return (
    <Dialog open={lead !== null} onOpenChange={(aberto) => !aberto && fechar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-4" />
            Abordar pelo WhatsApp da RGT
          </DialogTitle>
        </DialogHeader>

        {!dados && !erroCarga && (
          <div className="flex items-center gap-2 py-6 text-sm text-neutral-500">
            <Spinner /> Carregando…
          </div>
        )}
        {erroCarga && <p className="text-sm text-rose-700">{erroCarga}</p>}

        {dados && (
          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <Label>Pra quem vai</Label>
              <div className="grid grid-cols-2 gap-2">
                {(['advogado', 'credor'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => trocarDestino(d)}
                    disabled={pending}
                    className={cn(
                      'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      destino === d
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-200 hover:border-neutral-400',
                    )}
                  >
                    <span className="font-medium">{d === 'advogado' ? 'Advogado' : 'Credor'}</span>
                    <span
                      className={cn(
                        'block text-xs',
                        destino === d ? 'text-white/80' : 'text-neutral-500',
                      )}
                    >
                      {d === 'advogado'
                        ? 'conversa com você, sem robô'
                        : 'o robô atende a resposta'}
                    </span>
                  </button>
                ))}
              </div>
              {destino === 'advogado' && dados.advogadoNome && (
                // O DJEN não diz de que lado o advogado está, e a escolha
                // automática já errou: num lead real de 28/10, a advogada
                // gravada era procuradora do devedor. Proposta de cessão pro
                // advogado da parte contrária é o pior erro possível aqui.
                <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  Confira no processo se {dados.advogadoNome}
                  {dados.advogadoOab ? ` (OAB ${dados.advogadoOab})` : ''} é advogado(a) do{' '}
                  <strong>credor</strong>, e não do devedor, antes de enviar.
                </p>
              )}
              {destino === 'credor' && dados.advogadoNome && (
                <p className="text-xs text-amber-800">
                  Esse processo tem advogado ({dados.advogadoNome}
                  {dados.advogadoOab ? `, OAB ${dados.advogadoOab}` : ''}). A regra é falar com ele
                  primeiro.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="disparo-nome">
                  {destino === 'advogado' ? 'Nome do advogado' : 'Nome do credor'}
                </Label>
                <Input
                  id="disparo-nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="disparo-telefone">Celular com DDD</Label>
                <Input
                  id="disparo-telefone"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  placeholder="(82) 99999-9999"
                  inputMode="tel"
                  disabled={pending}
                />
              </div>
            </div>

            {previa && (
              <div className="flex flex-col gap-1.5">
                <Label>O que a pessoa vai receber</Label>
                <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm whitespace-pre-wrap text-neutral-800">
                  {previa}
                  <span className="mt-2 block text-xs text-neutral-500">
                    {MODELOS[destino].rodape}
                  </span>
                  <span className="mt-2 block rounded-md border border-emerald-200 bg-white px-2 py-1 text-center text-xs text-emerald-800">
                    Não quero receber
                  </span>
                </div>
                <p className="text-xs text-neutral-500">
                  Texto aprovado pela Meta: não dá pra editar. Assinado com o seu nome.
                </p>
              </div>
            )}

            {bloqueio && <p className="text-sm text-amber-800">{bloqueio}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={pending}>
            Cancelar
          </Button>
          <Button
            onClick={enviar}
            disabled={pending || !dados || Boolean(bloqueio) || nome.trim().length < 2 || !telefone}
          >
            {pending ? <Spinner /> : <Send className="size-4" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
