import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RGT App',
  description: 'Plataforma interna da RGT Capital',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
