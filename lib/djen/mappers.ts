/**
 * Mappers entre a camada crua (JSON literal da API) e a camada de aplicação.
 *
 * Toda transformação de shape mora aqui — se o CNJ mudar um campo na API, é
 * neste arquivo (+ types.raw.ts) que se conserta. O resto do sistema não vê.
 */

import { detectarRedFlags, extrairFatos, nomeEstaMascarado } from './red-flags';
import type { Publicacao } from './types';
import type { DjenItem } from './types.raw';

/** Normaliza CNJ: aceita mascarado ou cru, devolve 20 dígitos. */
export function normalizarCnj(cnj: string): string {
  return cnj.replace(/\D/g, '');
}

/** Aplica máscara padrão CNJ NNNNNNN-DD.AAAA.J.TR.OOOO em 20 dígitos crus. */
export function mascararCnj(cnj20: string): string {
  const d = normalizarCnj(cnj20);
  if (d.length !== 20) return cnj20;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
}

export function mapCruParaPublicacao(item: DjenItem): Publicacao {
  const destinatarios = (item.destinatarios ?? []).map((d) => ({
    nome: d.nome,
    polo: d.polo,
    mascarado: nomeEstaMascarado(d.nome),
  }));

  const advogados = (item.destinatarioadvogados ?? []).map((da) => ({
    id: da.advogado.id,
    nome: da.advogado.nome,
    oab: da.advogado.numero_oab,
    uf: da.advogado.uf_oab,
  }));

  return {
    id: item.id,
    hash: item.hash,
    dataDisponibilizacao: item.data_disponibilizacao,
    siglaTribunal: item.siglaTribunal,
    orgao: { id: item.idOrgao, nome: item.nomeOrgao },
    processo: {
      cnj: item.numero_processo,
      cnjMascarado: item.numeroprocessocommascara ?? mascararCnj(item.numero_processo),
    },
    tipoComunicacao: item.tipoComunicacao,
    tipoDocumento: item.tipoDocumento,
    classe: { codigo: item.codigoClasse, nome: item.nomeClasse },
    meio: item.meio,
    link: item.link,
    texto: item.texto,
    ativo: item.ativo,
    status: item.status,
    cancelamento:
      item.data_cancelamento && item.motivo_cancelamento
        ? { data: item.data_cancelamento, motivo: item.motivo_cancelamento }
        : null,
    destinatarios,
    advogados,
    redFlags: detectarRedFlags(item.texto ?? ''),
    extracao: extrairFatos(item.texto ?? ''),
    _raw: item,
  };
}

/**
 * Payload pra INSERT/UPSERT em `djen_publicacoes`. As colunas derivadas
 * (credor_nome, advogado_oab, etc) são preenchidas por trigger no banco —
 * não precisam ir daqui.
 */
export function paraLinhaBanco(pub: Publicacao): Record<string, unknown> {
  return {
    id: pub.id,
    hash: pub.hash,
    data_disponibilizacao: pub.dataDisponibilizacao,
    data_cancelamento: pub.cancelamento?.data ?? null,
    motivo_cancelamento: pub.cancelamento?.motivo ?? null,
    sigla_tribunal: pub.siglaTribunal,
    id_orgao: pub.orgao.id,
    nome_orgao: pub.orgao.nome,
    codigo_classe: pub.classe.codigo,
    nome_classe: pub.classe.nome,
    tipo_comunicacao: pub.tipoComunicacao,
    tipo_documento: pub.tipoDocumento,
    meio: pub.meio,
    ativo: pub.ativo,
    status: pub.status,
    numero_processo: pub.processo.cnj,
    numero_processo_mascara: pub.processo.cnjMascarado,
    link: pub.link,
    texto: pub.texto,
    destinatarios: pub.destinatarios,
    destinatario_advogados: pub.advogados.map((a) => ({
      advogado: { id: a.id, nome: a.nome, numero_oab: a.oab, uf_oab: a.uf },
    })),
    red_flags: pub.redFlags.map((f) => ({
      codigo: f.codigo,
      categoria: f.categoria,
      cor: f.cor,
      trecho: f.trecho,
    })),
    cessionario_conhecido: pub.extracao.cessionario ?? null,
    credor_cedente: pub.extracao.credorCedente ?? null,
    ano_orcamentario: pub.extracao.anoOrcamentario ?? null,
    raw: pub._raw,
  };
}
