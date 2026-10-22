'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { titleCase } from '@/lib/formatters';
import { ORIGEM_LEAD } from '@/lib/leads';
import type { ProcessoEncontrado } from '@/lib/djen/busca-por-nome';
import { criarLeadDaBusca } from './actions';

/** O que o diálogo precisa saber do processo achado. */
export type ProcessoParaLead = ProcessoEncontrado & { cnjExibido: string };

const hojeBR = () => new Date().toLocaleDateString('pt-BR');

function notaInicial(p: ProcessoParaLead): string {
  const linhas = [
    `Achado pela busca por nome no diário oficial (DJEN) em ${hojeBR()}.`,
    `${p.siglaTribunal} · ${p.orgao}`,
    `${p.publicacoes} publicaç${p.publicacoes === 1 ? 'ão' : 'ões'}, de ${p.primeiraPublicacao} a ${p.ultimaPublicacao}.`,
  ];
  if (p.fase.length > 0) linhas.push(`Fase: ${p.fase.join(', ')}.`);
  if (p.nosAutos.length > 1)
    linhas.push(`Nos autos também como: ${p.nosAutos.slice(1).join(' / ')}.`);
  return linhas.join('\n');
}

/**
 * Transforma um processo da busca em lead do CRM.
 *
 * Vem preenchido com o que o diário traz — nome como está nos autos, número,
 * devedor e uma nota com tribunal, vara e fase. O que o diário não traz
 * (telefone) fica pra pessoa completar. Só aparece em processo contra
 * governo: os outros não viram precatório.
 */
export function DialogCriarLead({
  processo,
  onFechar,
}: {
  processo: ProcessoParaLead | null;
  onFechar: () => void;
}) {
  // O pai troca a `key` a cada processo, então o estado nasce pronto aqui —
  // sem efeito para "resetar" o formulário.
  const [nome, setNome] = useState(() => titleCase(processo?.nosAutos[0] ?? ''));
  const [telefone, setTelefone] = useState('');
  const [origem, setOrigem] = useState<string>('whatsapp');
  const [devedor, setDevedor] = useState(() =>
    processo?.devedores[0]?.nome ? titleCase(processo.devedores[0].nome) : '',
  );
  const [notas, setNotas] = useState(() => (processo ? notaInicial(processo) : ''));
  const [criado, setCriado] = useState(false);
  const [existente, setExistente] = useState<{ id: string; nome: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function salvar() {
    if (!processo) return;
    startTransition(async () => {
      const r = await criarLeadDaBusca({
        nome,
        telefone,
        origem,
        ente_devedor: devedor,
        numero_processo: processo.cnjExibido,
        notas,
      });
      if (!r.ok) {
        if (r.leadExistente) setExistente(r.leadExistente);
        toast.error(r.error);
        return;
      }
      setCriado(true);
      toast.success('Lead criado no CRM');
    });
  }

  return (
    <Dialog open={processo !== null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-4" />
            Criar lead com este processo
          </DialogTitle>
          <DialogDescription>
            O lead entra no CRM na coluna Novo. Confira o nome e acrescente o telefone — o diário
            oficial não traz.
          </DialogDescription>
        </DialogHeader>

        {criado ? (
          <div className="space-y-3 text-sm">
            <p>
              <strong>{nome}</strong> está no CRM, com o processo {processo?.cnjExibido}.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={onFechar}>
                Continuar na busca
              </Button>
              <Link href="/crm" className={buttonVariants()}>
                Abrir o CRM
              </Link>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="lead-nome">Nome</Label>
              <Input
                id="lead-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="lead-tel">Telefone (opcional)</Label>
                <Input
                  id="lead-tel"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  placeholder="(82) 99123-4567"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="lead-origem">Como chegou</Label>
                <select
                  id="lead-origem"
                  value={origem}
                  onChange={(e) => setOrigem(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-neutral-200 bg-white px-2 text-sm"
                >
                  {ORIGEM_LEAD.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Número do processo</Label>
                <Input value={processo?.cnjExibido ?? ''} readOnly className="mt-1 font-mono" />
              </div>
              <div>
                <Label htmlFor="lead-devedor">Quem deve</Label>
                <Input
                  id="lead-devedor"
                  value={devedor}
                  onChange={(e) => setDevedor(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="lead-notas">Notas</Label>
              <Textarea
                id="lead-notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={4}
                className="mt-1 text-xs"
              />
            </div>

            {existente && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Já existe um lead para este processo: <strong>{existente.nome}</strong>.{' '}
                <Link href="/crm" className="font-medium underline">
                  Ver no CRM
                </Link>
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={onFechar} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={salvar} disabled={pending || nome.trim().length < 2}>
                {pending ? <Spinner /> : <UserPlus className="size-3.5" />}
                Criar lead
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
