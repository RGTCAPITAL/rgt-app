import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SectionHero } from '@/components/ui/section-hero';
import { COLUNAS_FATOR_LOA, fatorDaLinha, type LinhaFatorLoa } from '@/lib/precificacao/desagio';
import { hojeEmSaoPaulo } from '@/lib/datas';
import { PainelDesagio, type LoaEmUso } from './painel-desagio';

export default async function DesagioPage() {
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
          Apenas admin ou gestão pode definir o percentual de aquisição.
        </div>
      </div>
    );
  }

  const { data: linhas } = await supabase
    .from('fatores_loa')
    .select(COLUNAS_FATOR_LOA)
    .order('loa_ano')
    .order('vigente_desde', { ascending: false })
    .returns<LinhaFatorLoa[]>();

  const fatores = (linhas ?? []).map(fatorDaLinha);

  // Quais LOAs a carteira realmente tem. Sem isso a tela seria um formulário
  // vazio pedindo um ano que ele teria que lembrar de cabeça — e uma LOA sem
  // percentual cadastrado é justamente a que trava a precificação.
  const { data: ops } = await supabase
    .from('operacoes')
    .select('loa, is_exemplo')
    .not('loa', 'is', null)
    .returns<{ loa: number; is_exemplo: boolean }[]>();

  const contagem = new Map<number, { total: number; reais: number }>();
  for (const o of ops ?? []) {
    const atual = contagem.get(o.loa) ?? { total: 0, reais: 0 };
    atual.total += 1;
    if (!o.is_exemplo) atual.reais += 1;
    contagem.set(o.loa, atual);
  }
  const loasEmUso: LoaEmUso[] = [...contagem.entries()]
    .map(([ano, c]) => ({ ano, operacoes: c.total, operacoesReais: c.reais }))
    .sort((a, b) => a.ano - b.ano);

  return (
    <div className="mx-auto max-w-4xl">
      <SectionHero
        title="Percentual de aquisição"
        subtitle="Quanto a RGT paga por ano de LOA. O sistema não calcula isso — quem define é a gestão, e cada mudança fica registrada com a data em que passou a valer."
        color="amber"
      />
      {/* hojeIso vem do servidor e no fuso de São Paulo: no cliente o fuso do
          navegador discordaria, e em UTC o dia vira às 21h — bem quando a
          vigência muda. */}
      <PainelDesagio fatores={fatores} loasEmUso={loasEmUso} hojeIso={hojeEmSaoPaulo()} />
    </div>
  );
}
