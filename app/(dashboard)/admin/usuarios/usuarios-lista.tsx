'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { atualizarPerfil, toggleAtivo } from './actions';
import { ConvidarDialog } from './convidar-dialog';

export type UsuarioRow = {
  id: string;
  email: string;
  nome: string | null;
  ativo: boolean;
  created_at: string;
  perfil_slug: string | null;
};

const PERFIS = [
  { value: 'broker', label: 'Broker' },
  { value: 'juridico', label: 'Jurídico' },
  { value: 'gestao', label: 'Gestão' },
  { value: 'admin', label: 'Admin' },
] as const;

function fmtData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function corPerfil(slug: string | null): string {
  if (slug === 'admin') return 'bg-red-100 text-red-800';
  if (slug === 'gestao') return 'bg-blue-100 text-blue-800';
  if (slug === 'juridico') return 'bg-purple-100 text-purple-800';
  if (slug === 'broker') return 'bg-neutral-100 text-neutral-800';
  return 'bg-amber-100 text-amber-800'; // NULL = sem perfil
}

export function UsuariosLista({ usuarios, meuId }: { usuarios: UsuarioRow[]; meuId: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [_, startTransition] = useTransition();

  // Mudança de perfil só sai daqui depois de confirmada. Antes ia direto no
  // onChange do <select>, e no macOS o scroll do trackpad sobre um select
  // nativo troca a opção — dava pra promover um broker a admin sem clicar.
  const [trocaPerfil, setTrocaPerfil] = useState<{
    usuario: UsuarioRow;
    novoPerfil: string;
  } | null>(null);
  const [alvoAtivo, setAlvoAtivo] = useState<UsuarioRow | null>(null);

  function confirmarTrocaPerfil() {
    if (!trocaPerfil) return;
    const { usuario, novoPerfil } = trocaPerfil;
    const label = PERFIS.find((p) => p.value === novoPerfil)?.label ?? novoPerfil;
    setErro(null);
    setPendingId(usuario.id);
    setTrocaPerfil(null);
    startTransition(async () => {
      const res = await atualizarPerfil(usuario.id, novoPerfil);
      if (!res.ok) {
        setErro(res.error);
        toast.error(res.error);
      } else {
        toast.success(`${usuario.nome ?? usuario.email} agora é ${label}`);
      }
      setPendingId(null);
    });
  }

  function confirmarToggleAtivo() {
    if (!alvoAtivo) return;
    const u = alvoAtivo;
    const novoAtivo = !u.ativo;
    setErro(null);
    setPendingId(u.id);
    setAlvoAtivo(null);
    startTransition(async () => {
      const res = await toggleAtivo(u.id, novoAtivo);
      if (!res.ok) {
        setErro(res.error);
        toast.error(res.error);
      } else {
        toast.success(`${u.nome ?? u.email} ${novoAtivo ? 'reativado' : 'desativado'}`);
      }
      setPendingId(null);
    });
  }

  return (
    <div>
      {erro && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {erro}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <Button onClick={() => setConvidando(true)}>
          <UserPlus className="size-4" />
          Convidar usuário
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-neutral-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs tracking-wide text-neutral-500 uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Perfil</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Criado</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {usuarios.map((u) => {
                const eu = u.id === meuId;
                const carregando = pendingId === u.id;
                return (
                  <tr key={u.id} className={carregando ? 'opacity-50' : ''}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-neutral-900">{u.nome ?? '—'}</span>
                      {eu && (
                        <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                          você
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{u.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${corPerfil(u.perfil_slug)}`}
                      >
                        {PERFIS.find((p) => p.value === u.perfil_slug)?.label ?? 'sem perfil'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.ativo ? (
                        <span className="text-xs text-emerald-700">● Ativo</span>
                      ) : (
                        <span className="text-xs text-neutral-500">○ Desativado</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{fmtData(u.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <select
                          value={u.perfil_slug ?? ''}
                          onChange={(e) => {
                            const novo = e.target.value;
                            if (novo === u.perfil_slug) return;
                            setTrocaPerfil({ usuario: u, novoPerfil: novo });
                          }}
                          disabled={carregando}
                          className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 outline-none focus:border-neutral-900"
                        >
                          {PERFIS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setAlvoAtivo(u)}
                          disabled={carregando}
                          className={`rounded-md border px-3 py-1 text-xs font-medium ${
                            u.ativo
                              ? 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                              : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          } disabled:opacity-40`}
                        >
                          {u.ativo ? 'Desativar' : 'Ativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs text-neutral-500">
        Mudanças aplicam imediatamente. O único admin ativo não pode se rebaixar nem se desativar
        (proteção contra lock-out). Não existe cadastro aberto: todo usuário entra por convite
        daqui.
      </p>

      {convidando && <ConvidarDialog onClose={() => setConvidando(false)} />}

      <AlertDialog
        open={trocaPerfil !== null}
        onOpenChange={(aberto) => !aberto && setTrocaPerfil(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mudar o perfil de acesso?</AlertDialogTitle>
            <AlertDialogDescription>
              {trocaPerfil && (
                <>
                  <strong className="text-neutral-900">
                    {trocaPerfil.usuario.nome ?? trocaPerfil.usuario.email}
                  </strong>{' '}
                  deixa de ser{' '}
                  {PERFIS.find((p) => p.value === trocaPerfil.usuario.perfil_slug)?.label ??
                    'sem perfil'}{' '}
                  e passa a ser{' '}
                  <strong className="text-neutral-900">
                    {PERFIS.find((p) => p.value === trocaPerfil.novoPerfil)?.label}
                  </strong>
                  .
                  {trocaPerfil.novoPerfil === 'admin' && (
                    <span className="mt-2 block rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                      Admin enxerga e altera tudo, inclusive os perfis dos outros usuários.
                    </span>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarTrocaPerfil}>Mudar perfil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={alvoAtivo !== null}
        onOpenChange={(aberto) => !aberto && setAlvoAtivo(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {alvoAtivo?.ativo ? 'Desativar este usuário?' : 'Reativar este usuário?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {alvoAtivo && (
                <>
                  <strong className="text-neutral-900">{alvoAtivo.nome ?? alvoAtivo.email}</strong>{' '}
                  {alvoAtivo.ativo
                    ? 'perde o acesso ao sistema imediatamente. As operações e leads dele continuam no lugar.'
                    : 'volta a conseguir entrar no sistema com o perfil atual.'}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmarToggleAtivo}
              className={alvoAtivo?.ativo ? 'bg-red-600 text-white hover:bg-red-700' : undefined}
            >
              {alvoAtivo?.ativo ? 'Desativar' : 'Reativar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
