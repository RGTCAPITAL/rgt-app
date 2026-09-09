import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SectionHero } from '@/components/ui/section-hero';
import { DEF_SERIES, SERIES } from '@/lib/indices/series';
import { IndicesPainel, type ResumoSerie } from './indices-painel';

export default async function IndicesPage() {
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
          Apenas admin ou gestão pode ver os índices econômicos.
        </div>
      </div>
    );
  }

  type LinhaResumo = {
    serie: string;
    total: number;
    primeira_competencia: string | null;
    ultima_competencia: string | null;
    ultimo_valor: number | null;
    tem_numero_indice: boolean;
    coletado_em: string | null;
  };

  // Agrega no banco: puxar as linhas e contar em JS esbarraria no limite
  // default de 1000 do PostgREST e mostraria número errado.
  const { data: agregado } = await supabase.rpc('resumo_indices_economicos');
  const linhas = (agregado ?? []) as unknown as LinhaResumo[];

  const porSerie = new Map(linhas.map((a) => [a.serie, a]));

  const resumos: ResumoSerie[] = SERIES.map((s) => {
    const a = porSerie.get(s);
    return {
      serie: s,
      label: DEF_SERIES[s].label,
      usoNoCalculo: DEF_SERIES[s].usoNoCalculo,
      sgs: DEF_SERIES[s].sgs,
      total: a?.total ?? 0,
      primeiraCompetencia: a?.primeira_competencia ?? null,
      ultimaCompetencia: a?.ultima_competencia ?? null,
      ultimoValor: a?.ultimo_valor ?? null,
      temNumeroIndice: a?.tem_numero_indice ?? false,
      coletadoEm: a?.coletado_em ?? null,
    };
  });

  return (
    <div>
      <SectionHero
        title="Índices econômicos"
        subtitle="Séries oficiais do BCB e do IBGE usadas na correção monetária. Persistimos o valor e a data da coleta — uma proposta feita hoje tem que poder ser reproduzida daqui a um ano."
        color="violet"
      />

      <IndicesPainel resumos={resumos} />
    </div>
  );
}
