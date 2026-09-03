import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ImportForm } from './import-form';

export default async function ImportarProspeccaoPage() {
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

  if (role !== 'admin' && role !== 'gestao') {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          Apenas admin ou gestão pode importar planilhas de prospecção.
        </div>
      </div>
    );
  }

  return <ImportForm />;
}
