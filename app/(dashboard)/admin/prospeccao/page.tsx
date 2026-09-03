import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Upload, Search, Sparkles, UserPlus, XCircle, FileSpreadsheet } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { juditConfigurada } from '@/lib/judit/client';
import { buttonVariants } from '@/components/ui/button';
import { SectionHero, KpiTile } from '@/components/ui/section-hero';
import { cn } from '@/lib/utils';
import { ProspeccaoTable } from './client-table';

const PAGE_SIZE = 200;

type SearchParams = {
  lote?: string;
  status?: string;
  q?: string;
};

export default async function ProspeccaoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
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

  if (!role || !['admin', 'gestao', 'broker'].includes(role)) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          Sem permissão pra ver a fila de prospecção.
        </div>
      </div>
    );
  }

  // Query com filtros
  let query = supabase
    .from('prospeccao_precatorios')
    .select(
      'id, numero_processo, tribunal, ente_devedor_nome, valor_face, vencimento_ano, vara_origem, judit_status, cedente_nome_provavel, advogado_nome, advogado_oab, red_flags, status, fonte_lote, lead_id, responsavel_id',
    )
    .order('valor_face', { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE);

  if (sp.lote) query = query.eq('fonte_lote', sp.lote);
  if (sp.status) query = query.eq('status', sp.status);
  if (sp.q) {
    const q = sp.q.replace(/\D/g, '');
    if (q.length >= 3) query = query.ilike('numero_processo', `%${q}%`);
  }

  const { data: rows } = await query;

  // KPIs
  const { count: totalImportado } = await supabase
    .from('prospeccao_precatorios')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'importado');
  const { count: totalEnriquecido } = await supabase
    .from('prospeccao_precatorios')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'enriquecido');
  const { count: totalLeadCriado } = await supabase
    .from('prospeccao_precatorios')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'lead_criado');
  const { count: totalDescartado } = await supabase
    .from('prospeccao_precatorios')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'descartado');

  // Lotes disponíveis (pra filtro)
  const { data: lotesData } = await supabase
    .from('prospeccao_precatorios')
    .select('fonte_lote')
    .limit(1000);
  const lotes = Array.from(new Set((lotesData ?? []).map((l) => l.fonte_lote))).sort();

  const juditOn = juditConfigurada();

  return (
    <div>
      <SectionHero
        title="Prospecção de precatórios"
        subtitle="Fila pré-lead alimentada por planilhas oficiais dos tribunais. Judit enriquece com nome do credor, broker busca contato, vira lead."
        color="blue"
        action={
          <Link
            href="/admin/prospeccao/importar"
            className={cn(
              buttonVariants({ variant: 'default' }),
              'bg-white text-blue-700 hover:bg-white/90',
            )}
          >
            <Upload className="size-4" />
            Importar planilha
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="Importados"
          value={String(totalImportado ?? 0)}
          icon={FileSpreadsheet}
          color="neutral"
        />
        <KpiTile
          label="Enriquecidos"
          value={String(totalEnriquecido ?? 0)}
          icon={Sparkles}
          color="blue"
        />
        <KpiTile
          label="Viraram lead"
          value={String(totalLeadCriado ?? 0)}
          icon={UserPlus}
          color="emerald"
        />
        <KpiTile
          label="Descartados"
          value={String(totalDescartado ?? 0)}
          icon={XCircle}
          color="rose"
        />
      </div>

      {!juditOn && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <Search className="mt-0.5 size-4 shrink-0" />
          <div>
            <strong>Judit não configurada</strong> — batch de enriquecimento fica indisponível.
            Adicione <code>JUDIT_API_KEY</code> no .env.local pra habilitar.
          </div>
        </div>
      )}

      <ProspeccaoTable
        rows={rows ?? []}
        lotes={lotes}
        filtros={{ lote: sp.lote ?? '', status: sp.status ?? '', q: sp.q ?? '' }}
        role={role}
        juditOn={juditOn}
      />
    </div>
  );
}
