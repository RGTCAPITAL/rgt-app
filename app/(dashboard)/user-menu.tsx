'use client';

import { useRouter } from 'next/navigation';
import { LogOut, User } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function iniciais(email: string): string {
  const partes = email.split('@')[0].split(/[._-]+/);
  return partes
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function UserMenu({ email }: { email: string }) {
  const router = useRouter();

  function sair() {
    // Submete form POST /auth/signout programaticamente
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/auth/signout';
    document.body.appendChild(form);
    form.submit();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-medium text-white">
          {iniciais(email)}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-600" title={email}>
          {email}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        <div className="flex flex-col gap-0.5 px-2 py-1.5">
          <span className="text-xs text-neutral-500">Logado como</span>
          <span className="truncate text-sm font-medium">{email}</span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/')} className="gap-2">
          <User className="size-4" />
          Minha conta
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={sair} variant="destructive" className="gap-2">
          <LogOut className="size-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
