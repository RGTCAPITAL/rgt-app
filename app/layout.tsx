import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'RGT App',
  description: 'Plataforma interna da RGT Capital',
};

const menu = [
  { label: 'Dashboard', href: '/' },
  { label: 'CRM', href: '/crm' },
  { label: 'Operações', href: '/operacoes' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <div className="flex min-h-screen">
          <aside className="w-56 border-r border-neutral-200 bg-white p-6">
            <div className="mb-8 text-lg font-bold tracking-tight">rgt <span className="text-neutral-400">app</span></div>
            <nav className="flex flex-col gap-1">
              {menu.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
