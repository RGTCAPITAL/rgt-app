'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';

/**
 * Menu em gaveta pra tela menor que `lg` (1024px): celular e tablet em pé.
 *
 * A barra lateral fixa de 224px ocupava 60% de um celular e deixava o
 * conteúdo com ~150px — medido em 28/10. Acima de `lg` a barra lateral do
 * layout continua igual; este componente some.
 *
 * Mesma navegação (`SidebarNav`) e mesmo menu de usuário da barra lateral,
 * pra não existirem dois menus que divergem com o tempo.
 */
export function MenuMovel({ perfil, email }: { perfil: string | null; email: string }) {
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const fecharNoEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    // Sem isso a página de trás rola junto com o dedo no celular.
    const overflowAntes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', fecharNoEsc);
    return () => {
      document.body.style.overflow = overflowAntes;
      document.removeEventListener('keydown', fecharNoEsc);
    };
  }, [aberto]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="-ml-2 rounded-md p-2 text-neutral-700 hover:bg-neutral-100 lg:hidden"
        aria-label="Abrir menu"
        aria-expanded={aberto}
      >
        <Menu className="size-5" />
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <div className="absolute inset-0 bg-black/40" onClick={() => setAberto(false)} />
          <div
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col justify-between overflow-y-auto bg-white p-4 shadow-xl"
            // Tocar num link fecha a gaveta — inclusive o da página atual,
            // que não muda a rota e por isso não fecharia sozinho.
            onClickCapture={(e) => {
              if ((e.target as HTMLElement).closest('a')) setAberto(false);
            }}
          >
            <div>
              <div className="mb-6 flex items-center justify-between">
                <Link href="/" className="px-2" aria-label="Ir para o início">
                  <Image
                    src="/logo-header.png"
                    alt="RGT Capital"
                    width={175}
                    height={48}
                    className="h-9 w-auto"
                  />
                </Link>
                <button
                  type="button"
                  onClick={() => setAberto(false)}
                  className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100"
                  aria-label="Fechar menu"
                >
                  <X className="size-5" />
                </button>
              </div>
              <SidebarNav perfil={perfil} />
            </div>
            <div className="mt-6 border-t border-neutral-200 pt-3">
              <UserMenu email={email} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
