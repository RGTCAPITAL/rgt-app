'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { LIMITE_TEXTO_WHATSAPP } from '@/lib/whatsapp/conversas';
import { responderConversa } from './actions';

/**
 * Caixa de resposta do broker. `bloqueio` vem do servidor já com o motivo em
 * português — a tela mostra o porquê em vez de um botão cinza mudo. A action
 * confere tudo de novo: o bloqueio aqui é conforto, não segurança.
 */
export function Composer({
  conversaId,
  bloqueio,
}: {
  conversaId: string;
  bloqueio: string | null;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState('');
  const [pending, startTransition] = useTransition();

  function enviar() {
    if (!texto.trim() || pending) return;
    startTransition(async () => {
      const r = await responderConversa(conversaId, texto);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setTexto('');
      router.refresh();
    });
  }

  if (bloqueio) {
    return (
      <p className="border-t border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
        {bloqueio}
      </p>
    );
  }

  return (
    <form
      className="flex items-end gap-2 border-t border-neutral-200 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        enviar();
      }}
    >
      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          // Enter puro quebra linha, como no WhatsApp Web com mensagem longa.
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            enviar();
          }
        }}
        maxLength={LIMITE_TEXTO_WHATSAPP}
        rows={2}
        placeholder="Escreva a resposta… (Ctrl+Enter envia)"
        className="min-h-0 flex-1 resize-none"
        disabled={pending}
      />
      <Button type="submit" disabled={pending || !texto.trim()} aria-label="Enviar">
        {pending ? <Spinner /> : <Send className="size-4" />}
      </Button>
    </form>
  );
}
