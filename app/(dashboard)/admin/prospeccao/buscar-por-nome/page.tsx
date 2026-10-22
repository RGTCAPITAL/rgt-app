import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BuscaForm } from './busca-form';

/**
 * Varredura de 3 tribunais, serial, a 3,3 s por requisição pelo rate limiter do
 * DJEN. Um nome comum chega a 6 páginas e passa de um minuto — o default de
 * 10 s mataria a busca no meio. O Hobby da Vercel permite até 300 s.
 */
export const maxDuration = 300;

export default async function BuscarPorNomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();
  const role = usuario?.perfil?.slug;

  // Mesmo gate da fila de prospecção: o broker é quem recebe nome por WhatsApp.
  if (!role || !['admin', 'gestao', 'broker'].includes(role)) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          Sem permissão pra buscar processos por nome.
        </div>
      </div>
    );
  }

  return <BuscaForm />;
}
