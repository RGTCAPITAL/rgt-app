import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SectionHero } from '@/components/ui/section-hero';
import { ListaModelos, type ModeloRow } from './lista-modelos';

export default async function MensagensPage() {
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
  const role = usuario?.perfil?.slug ?? '';

  if (!['admin', 'gestao'].includes(role)) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          Apenas admin ou gestão pode editar os textos de contato.
        </div>
      </div>
    );
  }

  const { data: modelos } = await supabase
    .from('modelos_mensagem')
    .select('id, nome, texto, requer_valor, requer_ente, uso, ordem, ativo, updated_at')
    .order('ordem')
    .returns<ModeloRow[]>();

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHero
        title="Mensagens de contato"
        subtitle="O texto que abre pronto quando alguém clica no WhatsApp de um lead. Quem envia continua sendo a pessoa, do próprio aparelho."
        color="blue"
      />
      <ListaModelos modelos={modelos ?? []} />
    </div>
  );
}
