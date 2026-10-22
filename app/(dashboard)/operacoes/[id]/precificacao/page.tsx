import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { obterFatorCorrecao } from '@/lib/precificacao/correcao';
import { montarCascata } from '@/lib/precificacao/cascata';
import type { EntradaCascata } from '@/lib/precificacao/tipos';
import {
  avaliarProposta,
  COLUNAS_FATOR_LOA,
  fatorDaLinha,
  sugerirPreco,
  type LinhaFatorLoa,
} from '@/lib/precificacao/desagio';
import { hojeEmSaoPaulo } from '@/lib/datas';
import type { Serie } from '@/lib/indices/series';
import { buttonVariants } from '@/components/ui/button';
import { FolhaCalculo } from './folha-calculo';

/**
 * Tela de precificação.
 *
 * O cálculo roda no servidor e desce como linhas prontas. O cliente só
 * apresenta — assim a conta que aparece na tela é literalmente a mesma que
 * seria gravada, sem chance de divergirem.
 *
 * A tela existe porque hoje o Renato faz isso no Excel: lê o ofício, corrige
 * da data-base até hoje, tira PSS e IR, chega no líquido e aplica o deságio.
 * Se ele não conseguir auditar cada linha aqui, volta pro Excel mesmo que a
 * conta esteja certa — por isso cada valor diz de onde veio.
 */

type OperacaoPrecificacao = {
  id: string;
  numero_processo: string;
  cedente_nome: string;
  tipo: string;
  natureza: string | null;
  especie: string | null;
  tribunal: string;
  loa: number | null;
  valor_principal: number | null;
  valor_juros: number | null;
  valor_selic: number | null;
  valor_total: number | null;
  data_base: string | null;
  indice_correcao: Serie | null;
  atualizar_valores_ate: string | null;
  pss_ativo: boolean | null;
  pss_pct: number | null;
  pss_valor: number | null;
  rra_ativo: boolean | null;
  rra_meses: number | null;
  retencao_honorarios_pct: number | null;
  percentual_aquisicao: number | null;
  preco_proposto: number | null;
  preco_aceito: boolean | null;
  preco_proposto_em: string | null;
  preco_justificativa: string | null;
  fator_loa_id: string | null;
  definidor: { nome: string } | null;
  etapa_atual: string;
  ente: { nome: string } | null;
};

export default async function PrecificacaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: op } = await supabase
    .from('operacoes')
    .select(
      `id, numero_processo, cedente_nome, tipo, natureza, especie, tribunal, loa,
       valor_principal, valor_juros, valor_selic, valor_total,
       data_base, indice_correcao, atualizar_valores_ate,
       pss_ativo, pss_pct, pss_valor, rra_ativo, rra_meses,
       retencao_honorarios_pct, percentual_aquisicao, etapa_atual,
       preco_proposto, preco_aceito, preco_proposto_em, preco_justificativa, fator_loa_id,
       definidor:usuarios!operacoes_preco_proposto_por_fkey(nome),
       ente:entes_devedores(nome)`,
    )
    .eq('id', id)
    .single<OperacaoPrecificacao>();

  if (!op) notFound();

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();
  const role = usuario?.perfil?.slug ?? '';
  const podeEditar = ['admin', 'gestao'].includes(role);

  const hoje = hojeEmSaoPaulo();
  const dataFinal = op.atualizar_valores_ate ?? hoje;

  // Sem data-base ou sem índice não há o que corrigir. A tela mostra o
  // motivo em vez de exibir um valor que seria chute.
  const faltaBase: string[] = [];
  if (!op.data_base) faltaBase.push('data-base do cálculo');
  if (!op.indice_correcao) faltaBase.push('índice de correção do ofício');
  if (op.valor_principal === null) faltaBase.push('valor principal');

  let fator: number | null = null;
  let erroFator: string | null = null;
  let metodoFator: string | null = null;
  let competenciaFinal: string | null = null;
  let truncado = false;

  if (faltaBase.length === 0) {
    const r = await obterFatorCorrecao(op.indice_correcao!, op.data_base!, dataFinal);
    if (r.ok) {
      fator = r.fator;
      metodoFator = r.metodo;
      competenciaFinal = r.competenciaFinal;
      truncado = r.truncadoNaUltima;
    } else {
      erroFator = r.erro;
    }
  }

  const entrada: EntradaCascata = {
    composicao: {
      principal: op.valor_principal ?? 0,
      juros: op.valor_juros ?? 0,
      correcao: op.valor_selic ?? 0,
      dataBase: op.data_base ?? hoje,
      indice: op.indice_correcao ?? 'ipca',
    },
    deducoes: {
      // O valor do ofício vence o percentual digitado: documento é mais
      // confiável que memória de quem cadastrou.
      pssValor:
        op.pss_valor ??
        (op.pss_pct !== null && op.valor_principal !== null
          ? Math.round(((op.valor_principal * op.pss_pct) / 100) * 100) / 100
          : null),
      pssIncide: op.pss_ativo ?? false,
      honorariosContratuaisValor: null,
      honorariosContratuaisPct: op.retencao_honorarios_pct,
      cessaoAnterior: null,
      penhora: null,
      compensacaoTributaria: null,
    },
    tributacao: {
      irIncide: op.rra_ativo ?? false,
      rraMeses: op.rra_meses,
    },
    // A conta vai até onde a série alcança. Usar a data pedida aqui faria
    // as linhas dizerem 10/2026 enquanto o fator é de 09/2026.
    dataFinal: competenciaFinal ?? dataFinal,
    fatorCorrecao: fator,
  };

  const cascata = faltaBase.length === 0 ? montarCascata(entrada) : null;

  // O percentual da LOA é do Renato, não do sistema (RGT-96). Aqui ele só é
  // aplicado: a sugestão sai do fator vigente hoje, e a situação diz se a
  // proposta já feita ficou pra trás depois que ele mudou o percentual.
  const { data: linhasFator } = op.loa
    ? await supabase
        .from('fatores_loa')
        .select(COLUNAS_FATOR_LOA)
        .eq('loa_ano', op.loa)
        .returns<LinhaFatorLoa[]>()
    : { data: [] as LinhaFatorLoa[] };
  const fatores = (linhasFator ?? []).map(fatorDaLinha);

  const situacao = avaliarProposta({
    fatores,
    loaAno: op.loa,
    fatorUsadoId: op.fator_loa_id,
    temProposta: op.preco_proposto !== null,
    hojeIso: hoje,
  });
  const fatorAtual = 'atual' in situacao ? situacao.atual : null;
  const sugestao = fatorAtual
    ? sugerirPreco({
        fator: fatorAtual,
        brutoAtualizado: cascata?.brutoAtualizado ?? null,
        liquido: cascata?.liquidoDisponivel ?? null,
        percentualAquisicao: op.percentual_aquisicao ?? 100,
        provisorio: cascata?.provisorio ?? false,
      })
    : null;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={`/operacoes/${op.id}`}
        className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'mb-4 -ml-2' })}
      >
        <ArrowLeft className="size-4" />
        Voltar para a operação
      </Link>

      <FolhaCalculo
        operacao={{
          id: op.id,
          numeroProcesso: op.numero_processo,
          cedente: op.cedente_nome,
          tipo: op.tipo,
          natureza: op.natureza,
          especie: op.especie,
          tribunal: op.tribunal,
          enteDevedor: op.ente?.nome ?? null,
          loa: op.loa,
          dataBase: op.data_base,
          indice: op.indice_correcao,
          percentualAquisicao: op.percentual_aquisicao,
          precoProposto: op.preco_proposto,
          precoAceito: op.preco_aceito,
          precoDefinidoEm: op.preco_proposto_em,
          precoDefinidoPor: op.definidor?.nome ?? null,
          precoJustificativa: op.preco_justificativa,
          etapaAtual: op.etapa_atual,
        }}
        cascata={cascata}
        dataFinal={dataFinal}
        faltaBase={faltaBase}
        erroFator={erroFator}
        metodoFator={metodoFator}
        competenciaFinal={competenciaFinal}
        truncado={truncado}
        podeEditar={podeEditar}
        desagio={{ situacao, sugestao }}
      />
    </div>
  );
}
