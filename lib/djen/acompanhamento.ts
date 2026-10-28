import type { SupabaseClient } from '@supabase/supabase-js';
import { buscarPorCnj } from './client';
import { paraLinhaBanco } from './mappers';
import { infoRedFlag, ordenarFlagsParaExibir, temAlertaGrave } from './red-flags';
import type { Publicacao } from './types';

/**
 * "O processo andou": todo dia, olha o DJEN dos processos que a RGT está
 * negociando ou operando e avisa o dono quando sai publicação nova.
 *
 * Por que importa: precatório pago, cedido a outro comprador ou penhorado mata
 * o negócio — e sem isso ninguém fica sabendo até ligar pro credor. O DJEN
 * só era lido quando alguém clicava em enriquecer.
 *
 * Primeira vez que um processo é visto não gera aviso: o histórico inteiro
 * seria "novo", e o broker receberia vinte avisos de coisas de 2024. A
 * primeira passada só registra a linha de base.
 */

export interface AlvoAcompanhado {
  tipo: 'lead' | 'operacao';
  id: string;
  nome: string;
  /** Quem recebe o aviso. Vazio: vai pra admin e gestão. */
  donos: string[];
  link: string;
}

export interface ResumoNovidades {
  titulo: string;
  descricao: string;
  urgente: boolean;
}

function fmtData(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/**
 * O texto do aviso. Mostra o sinal mais importante em português (cessão e
 * pagamento antes de ofício, ofício antes de aviso amarelo) e conta o resto.
 * Alerta grave — alguém comprou, foi pago, penhora — vira urgente.
 */
export function resumirNovidades(nome: string, novas: readonly Publicacao[]): ResumoNovidades {
  const codigos = ordenarFlagsParaExibir([
    ...new Set(novas.flatMap((p) => p.redFlags.map((f) => f.codigo))),
  ]).filter((c) => c !== 'X7'); // boilerplate de toda expedição: não é notícia
  const urgente = temAlertaGrave(codigos);
  const maisRecente = novas.reduce(
    (a, p) => (p.dataDisponibilizacao > a ? p.dataDisponibilizacao : a),
    '',
  );

  const qtd = novas.length === 1 ? '1 publicação nova' : `${novas.length} publicações novas`;
  const sinal = codigos.length
    ? ` ${infoRedFlag(codigos[0]).descricaoHumana}${codigos.length > 1 ? ` (+${codigos.length - 1} sinal${codigos.length > 2 ? 's' : ''})` : ''}`
    : ` ${novas[0]?.tipoDocumento || novas[0]?.tipoComunicacao || 'Leia a publicação.'}`;

  return {
    titulo: urgente
      ? `ATENÇÃO: o processo de ${nome} teve publicação grave`
      : `Processo andou: ${nome}`,
    descricao: `${qtd} no Diário${maisRecente ? ` (${fmtData(maisRecente)})` : ''}.${sinal}`,
    urgente,
  };
}

function cnj20(numero: string | null): string | null {
  const d = (numero ?? '').replace(/\D/g, '');
  return d.length === 20 ? d : null;
}

/**
 * Processos acompanhados: leads ainda em negociação e operações em andamento.
 * Dado de exemplo fica de fora — o número de processo pode até ser real, e
 * avisar sobre ele confundiria.
 */
export async function carregarAlvos(sb: SupabaseClient): Promise<Map<string, AlvoAcompanhado[]>> {
  const [{ data: leads }, { data: ops }] = await Promise.all([
    sb
      .from('leads')
      .select('id, nome, numero_processo, dono_id')
      .not('numero_processo', 'is', null)
      .not('status', 'in', '(ganho,perdido)')
      .eq('is_exemplo', false),
    sb
      .from('operacoes')
      .select('id, cedente_nome, numero_processo, dono_id, broker_id')
      .not('numero_processo', 'is', null)
      .not('etapa_atual', 'in', '(finalizada,cancelada)')
      .eq('is_exemplo', false),
  ]);

  const porCnj = new Map<string, AlvoAcompanhado[]>();
  const add = (cnj: string | null, alvo: AlvoAcompanhado) => {
    if (!cnj) return;
    porCnj.set(cnj, [...(porCnj.get(cnj) ?? []), alvo]);
  };

  for (const l of leads ?? []) {
    add(cnj20(l.numero_processo as string), {
      tipo: 'lead',
      id: l.id as string,
      nome: l.nome as string,
      donos: l.dono_id ? [l.dono_id as string] : [],
      link: '/crm',
    });
  }
  for (const o of ops ?? []) {
    add(cnj20(o.numero_processo as string), {
      tipo: 'operacao',
      id: o.id as string,
      nome: (o.cedente_nome as string | null) ?? 'operação sem nome',
      donos: [...new Set([o.dono_id, o.broker_id].filter(Boolean) as string[])],
      link: `/operacoes/${o.id as string}`,
    });
  }
  return porCnj;
}

async function idsDaEquipe(sb: SupabaseClient, slugs: string[]): Promise<string[]> {
  const { data: perfis } = await sb.from('perfis').select('id').in('slug', slugs);
  const { data } = await sb
    .from('usuarios')
    .select('id')
    .eq('ativo', true)
    .in(
      'perfil_id',
      (perfis ?? []).map((p) => p.id),
    );
  return (data ?? []).map((u) => u.id as string);
}

export interface ResultadoAcompanhamento {
  acompanhados: number;
  verificados: number;
  comNovidade: number;
  linhaDeBase: number;
  avisos: number;
  falhas: number;
}

/**
 * Uma passada. Começa pelos processos vistos há mais tempo, e para antes do
 * prazo da função: o DJEN aceita 20 consultas por minuto (o cliente já espera
 * entre uma e outra), e a função tem 5 minutos.
 */
export async function acompanharProcessos(
  sb: SupabaseClient,
  opts: { limite?: number; prazoMs?: number; agora?: () => number } = {},
): Promise<ResultadoAcompanhamento> {
  const limite = opts.limite ?? 75;
  const agora = opts.agora ?? Date.now;
  const fim = agora() + (opts.prazoMs ?? 270_000);

  const alvos = await carregarAlvos(sb);
  const r: ResultadoAcompanhamento = {
    acompanhados: alvos.size,
    verificados: 0,
    comNovidade: 0,
    linhaDeBase: 0,
    avisos: 0,
    falhas: 0,
  };
  if (!alvos.size) return r;

  const { data: vistos } = await sb
    .from('djen_acompanhamento')
    .select('numero_processo, verificado_em')
    .in('numero_processo', [...alvos.keys()]);
  const vistoEm = new Map(
    (vistos ?? []).map((v) => [v.numero_processo as string, v.verificado_em as string]),
  );

  // Nunca vistos primeiro, depois os mais antigos.
  const fila = [...alvos.keys()]
    .sort((a, b) => (vistoEm.get(a) ?? '').localeCompare(vistoEm.get(b) ?? ''))
    .slice(0, limite);

  let admins: string[] | null = null;
  let equipe: string[] | null = null;

  for (const cnj of fila) {
    if (agora() > fim) break;
    try {
      const pubs = await buscarPorCnj(cnj);
      const { data: conhecidas } = await sb
        .from('djen_publicacoes')
        .select('id')
        .eq('numero_processo', cnj);
      const jaVisto = vistoEm.has(cnj) || (conhecidas?.length ?? 0) > 0;
      const idsConhecidos = new Set((conhecidas ?? []).map((p) => Number(p.id)));
      const novas = pubs.filter((p) => !idsConhecidos.has(p.id));

      if (novas.length) {
        const { error } = await sb
          .from('djen_publicacoes')
          .upsert(novas.map(paraLinhaBanco), { onConflict: 'id' });
        if (error) throw new Error(error.message);
      }

      await sb.from('djen_acompanhamento').upsert({
        numero_processo: cnj,
        verificado_em: new Date(agora()).toISOString(),
        ultima_publicacao: pubs[0]?.dataDisponibilizacao ?? null,
      });
      r.verificados++;

      if (!jaVisto) {
        r.linhaDeBase++;
        continue;
      }
      if (!novas.length) continue;
      r.comNovidade++;

      const notifs = [];
      for (const alvo of alvos.get(cnj)!) {
        const resumo = resumirNovidades(alvo.nome, novas);
        let para = alvo.donos;
        if (!para.length) para = equipe ??= await idsDaEquipe(sb, ['admin', 'gestao']);
        if (resumo.urgente)
          para = [...new Set([...para, ...(admins ??= await idsDaEquipe(sb, ['admin']))])];
        for (const destinatario of para) {
          notifs.push({
            destinatario,
            tipo: 'processo_andou',
            titulo: resumo.titulo,
            descricao: resumo.descricao,
            link: alvo.link,
          });
        }
      }
      if (notifs.length) {
        const { error } = await sb.from('notificacoes').insert(notifs);
        if (error) throw new Error(error.message);
        r.avisos += notifs.length;
      }
    } catch (e) {
      r.falhas++;
      console.error('[djen/acompanhamento]', cnj, e instanceof Error ? e.message : e);
    }
  }
  return r;
}
