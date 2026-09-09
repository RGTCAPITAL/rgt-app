'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { UserPlus, Mail } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { convidarUsuario } from './actions';

const PERFIS = [
  { value: 'broker', label: 'Broker', ajuda: 'Vê só os próprios leads e operações' },
  { value: 'juridico', label: 'Jurídico', ajuda: 'Due diligence, documentos e consulta Judit' },
  { value: 'gestao', label: 'Gestão', ajuda: 'Vê tudo, importa planilhas, gerencia pipeline' },
  { value: 'admin', label: 'Admin', ajuda: 'Controle total, incluindo usuários' },
] as const;

export function ConvidarDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [perfil, setPerfil] = useState<string>('broker');
  const [pending, startTransition] = useTransition();

  function submeter() {
    startTransition(async () => {
      const res = await convidarUsuario(email, nome, perfil);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Convite enviado para ${email.trim().toLowerCase()}`);
      router.refresh();
      onClose();
    });
  }

  const perfilInfo = PERFIS.find((p) => p.value === perfil);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-emerald-600" />
            Convidar usuário
          </DialogTitle>
          <DialogDescription>
            A pessoa recebe um e-mail pra definir a própria senha e já entra com o perfil escolhido
            aqui.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="conv-nome">
              Nome <span className="text-red-500">*</span>
            </Label>
            <Input
              id="conv-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              disabled={pending}
              placeholder="Ex: Beatriz Andrade"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="conv-email">
              E-mail <span className="text-red-500">*</span>
            </Label>
            <Input
              id="conv-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              placeholder="beatriz@rgtcapital.com.br"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="conv-perfil">
              Perfil <span className="text-red-500">*</span>
            </Label>
            <select
              id="conv-perfil"
              value={perfil}
              onChange={(e) => setPerfil(e.target.value)}
              disabled={pending}
              className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-900"
            >
              {PERFIS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {perfilInfo && <p className="text-[11px] text-neutral-500">{perfilInfo.ajuda}</p>}
          </div>

          <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <Mail className="mt-0.5 size-4 shrink-0" />
            <div>
              O convite chega por e-mail e vale como primeiro acesso. Se não chegar, confira o SMTP
              do projeto no painel do Supabase.
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submeter} disabled={pending || !nome.trim() || !email.trim()}>
            {pending ? (
              <>
                <Spinner size={3} />
                Enviando…
              </>
            ) : (
              <>
                <UserPlus className="size-4" />
                Enviar convite
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
