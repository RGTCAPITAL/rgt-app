/**
 * Recalcula credor, advogado e red flags da fila de prospecção a partir das
 * publicações do DJEN que já estão em `djen_publicacoes`, e diz o que mudaria
 * em `prospeccao_precatorios` — sem chamar a API de novo.
 *
 * Por que existe: a consolidação nova (`lib/djen/consolidar.ts`) e as regras
 * novas de red flag (`lib/djen/red-flags.ts`) só valem pra linha que passar de
 * novo pelo batch. Rodar o batch nos 126 enriquecidos são ~7 min de DJEN pra
 * reler publicações que já temos guardadas. Aqui a gente recalcula em cima do
 * `raw` salvo e mostra o diff antes de gravar.
 *
 * Duas classes de mudança, e a diferença importa:
 *   - corrigir: o valor atual está comprovadamente errado ou vazio (ente,
 *     perito, empresa, advogado do outro lado, flag que a regra nova não dá
 *     mais). Pode aplicar em lote.
 *   - revisar: o valor atual é uma pessoa física plausível e o recálculo
 *     aponta OUTRA pessoa. Em ação plúrima os dois costumam ser credores do
 *     mesmo processo, e grafia diferente da mesma pessoa também cai aqui.
 *     Trocar no automático apagaria um nome que pode estar certo — então
 *     só mostra, nunca aplica. Advogado também cai aqui quando iria pra
 *     vazio mas é advogado do credor em outro processo do lote.
 *
 * Função pura (sem banco, sem rede): a server action lê e grava, isto aqui só
 * compara, e é o que os testes cobrem.
 */

import {
  motivoNaoCredor,
  type AdvogadoConsolidado,
  type CredorConsolidado,
  type MotivoNaoCredor,
} from '@/lib/djen/consolidar';
import { normalizarNome } from '@/lib/djen/devedor-publico';
import { nomeEstaMascarado } from '@/lib/djen/red-flags';

/** O que a action lê de `prospeccao_precatorios`. */
export type LinhaProspeccaoAtual = {
  id: string;
  numero_processo: string;
  valor_face: number | null;
  status: string;
  cedente_nome_provavel: string | null;
  advogado_nome: string | null;
  advogado_oab: string | null;
  red_flags: readonly string[] | null;
};

/** Saída de `consolidarProcesso` + os advogados citados no processo. */
export type ProcessoConsolidado = {
  credor: CredorConsolidado;
  advogado: AdvogadoConsolidado;
  redFlags: readonly string[];
  /**
   * Nomes de advogado listados nas publicações. Servem pra reconhecer o caso
   * em que o batch antigo gravou um advogado como credor (o DJEN lista os
   * dois misturados em ordem alfabética).
   */
  advogadosCitados?: readonly string[];
  /** Advogados que o texto deste processo liga ao lado que deve. */
  advogadosDevedor?: readonly { nome: string; oab: string }[];
};

export type CampoDiff = 'credor' | 'advogado' | 'red_flags';
export type TipoDiff = 'corrigir' | 'revisar';

export type LinhaDiff = {
  id: string;
  numero_processo: string;
  valor_face: number | null;
  campo: CampoDiff;
  /** Texto pra tela. Null = vazio (credor/advogado) ou nenhuma (red flags). */
  antes: string | null;
  depois: string | null;
  tipo: TipoDiff;
  /** Frase curta em PT-BR dizendo por que mudou — vai direto pra tabela do diálogo. */
  motivo: string;
};

export type ResumoDiff = {
  credorCorrigir: number;
  credorRevisar: number;
  /** Advogados que mudam ('corrigir'). */
  advogado: number;
  /** Advogados que ficam como estão por evidência de que são do credor ('revisar'). */
  advogadoRevisar: number;
  redFlags: number;
};

/** Colunas de `prospeccao_precatorios` que o recálculo pode escrever. Nada além disso. */
export type ColunasReconsolidadas = {
  cedente_nome_provavel?: string;
  advogado_nome?: string | null;
  advogado_oab?: string | null;
  red_flags?: string[];
};

export type AtualizacaoLinha = {
  id: string;
  numero_processo: string;
  /** Status visto na leitura — o update só vale se ainda for esse. */
  statusLido: string;
  colunas: ColunasReconsolidadas;
};

// ---------------------------------------------------------------------------
// Nomes
// ---------------------------------------------------------------------------

function limpo(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

/**
 * Nome sem o marcador de espólio, normalizado, + se havia marcador. O batch
 * novo escreve "NOME (ESPÓLIO)"; o polo do DJEN às vezes traz "ESPÓLIO DE
 * NOME" ou "NOME (ESPÓLIO DE)". Os três são a mesma pessoa.
 */
function separarEspolio(nome: string): { base: string; espolio: boolean } {
  let n = normalizarNome(nome);
  let espolio = false;
  if (/\(ESPOLIO(?: DE)?\)/.test(n)) {
    espolio = true;
    n = n.replace(/\s*\(ESPOLIO(?: DE)?\)\s*/g, ' ');
  }
  const prefixo = /(?:^|\s)ESPOLIO D[EOA]\s+(.+)$/.exec(n);
  if (prefixo) {
    espolio = true;
    n = prefixo[1]!;
  }
  return { base: n.replace(/\s+/g, ' ').trim(), espolio };
}

type ProblemaCredor = MotivoNaoCredor | 'nome mascarado' | 'nome incompleto';

/**
 * Por que o credor gravado hoje não serve — ou null se é uma pessoa física
 * plausível. Além do `motivoNaoCredor` da consolidação, pega o que o batch
 * antigo deixava passar: nome mascarado pelo tribunal ("J.M.C.D.S.",
 * "J. M. C. DOS S.") e sigla de uma palavra só.
 */
function problemaDoCredorAtual(
  nome: string,
  ctx: { peritos?: ReadonlySet<string>; advogados?: readonly string[] },
): ProblemaCredor | null {
  if (nomeEstaMascarado(nome)) return 'nome mascarado';
  const palavras = normalizarNome(nome).split(' ');
  const iniciais = palavras.filter((p) => p.replace(/\./g, '').length === 1).length;
  if (iniciais >= 2 && iniciais * 2 >= palavras.length) return 'nome mascarado';
  if (palavras.length < 2) return 'nome incompleto';
  return motivoNaoCredor(nome, ctx);
}

const DESCRICAO_PROBLEMA: Record<ProblemaCredor, string> = {
  'ente público': 'é ente público (o lado que deve)',
  'empresa, escritório ou sindicato': 'é empresa, escritório ou sindicato',
  'advogado do processo': 'é advogado do processo',
  perito: 'é perito do processo',
  'nome mascarado': 'está mascarado pelo tribunal',
  'nome incompleto': 'é sigla ou nome incompleto',
};

/** De onde veio o nome novo, no fim de uma frase ("o novo vem do cabeçalho..."). */
function ondeAchou(credor: CredorConsolidado): string {
  if (credor.fonte === 'cabecalho') return 'do cabeçalho do processo';
  if (credor.fonte === 'recurso') return 'do recurso (parte recorrida)';
  if (credor.fonte === 'polo') return 'dos destinatários do DJEN';
  return 'do DJEN';
}

function diffCredor(
  linha: LinhaProspeccaoAtual,
  proc: ProcessoConsolidado,
  peritos: ReadonlySet<string> | undefined,
): Omit<LinhaDiff, 'id' | 'numero_processo' | 'valor_face' | 'campo'> | null {
  const antes = limpo(linha.cedente_nome_provavel);
  const depois = limpo(proc.credor.nome);
  if (!antes && !depois) return null;
  // Acento e caixa diferentes não são mudança: o polo do DJEN e o cabeçalho
  // grafam o mesmo nome de jeitos diferentes, e reescrever isso é ruído.
  if (antes && depois && normalizarNome(antes) === normalizarNome(depois)) return null;

  if (!antes) {
    return {
      antes,
      depois,
      tipo: 'corrigir',
      motivo: `Estava vazio; o nome vem ${ondeAchou(proc.credor)}.`,
    };
  }

  const problema = problemaDoCredorAtual(antes, {
    peritos,
    advogados: proc.advogadosCitados,
  });

  if (!depois) {
    // Só acontece quando o processo inteiro é mascarado ou só tem parte
    // descartada. Não apaga: um nome errado à vista é mais fácil de
    // consertar à mão que um campo vazio sem explicação.
    return {
      antes,
      depois,
      tipo: 'revisar',
      motivo: problema
        ? `O nome atual ${DESCRICAO_PROBLEMA[problema]}, mas o DJEN não trouxe outro credor.`
        : 'O DJEN não confirmou esse nome no cabeçalho nem nos destinatários.',
    };
  }

  if (problema) {
    // Em ação com vários credores o cabeçalho põe um deles primeiro, que pode
    // não ser o dono deste precatório: a troca vale (o atual é certamente
    // errado), mas o admin precisa saber que o novo é o primeiro da lista.
    const plurima = proc.credor.plurima
      ? ' Ação com vários credores: confirme no PJe o titular deste precatório.'
      : '';
    return {
      antes,
      depois,
      tipo: 'corrigir',
      motivo: `O nome atual ${DESCRICAO_PROBLEMA[problema]}; o novo vem ${ondeAchou(proc.credor)}.${plurima}`,
    };
  }

  const a = separarEspolio(antes);
  const d = separarEspolio(depois);
  if (a.base === d.base) {
    // Mesma pessoa. Ganhar o "(ESPÓLIO)" é informação nova (quem negocia é o
    // inventariante); perder é o contrário, então não aplica sozinho.
    if (a.espolio && !d.espolio) {
      return {
        antes,
        depois,
        tipo: 'revisar',
        motivo: 'O nome atual marca espólio e o recálculo não.',
      };
    }
    return {
      antes,
      depois,
      tipo: 'corrigir',
      motivo:
        d.espolio && !a.espolio
          ? 'Mesmo credor; o processo diz que é espólio.'
          : 'Mesmo credor; só muda a grafia.',
    };
  }

  // Duas pessoas físicas diferentes: nunca troca sozinho.
  const atualEhCoautor = proc.credor.outros.some((o) => separarEspolio(o).base === a.base);
  // Os textos não podem empurrar o admin pra troca: nos casos reais o atual
  // muitas vezes é o certo (herdeira habilitada, substituído do sindicato).
  let motivo: string;
  if (proc.credor.fonte === 'polo') {
    motivo =
      'Não há cabeçalho de credor neste processo; o novo nome vem só da lista de destinatários. Mantenha o atual até conferir no PJe.';
  } else if (d.espolio && atualEhCoautor) {
    motivo =
      'O cabeçalho cita o espólio do novo nome; o atual pode ser o herdeiro habilitado. Confira no PJe antes de trocar.';
  } else if (proc.credor.plurima || atualEhCoautor) {
    motivo =
      'Ação com vários credores: os dois estão no processo. Confira no PJe de quem é este precatório antes de trocar.';
  } else {
    motivo = `O novo nome vem ${ondeAchou(proc.credor)} e é outra pessoa. Pode ser outra grafia ou coautor.`;
  }
  return { antes, depois, tipo: 'revisar', motivo };
}

// ---------------------------------------------------------------------------
// Advogado
// ---------------------------------------------------------------------------

/** "6191-B/AL", "06191B/al" e "6191B/AL" são a mesma inscrição. */
function normalizarOab(oab: string | null): string {
  if (!oab) return '';
  const [numero = '', uf = ''] = oab.split('/');
  const n = numero
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/^0+/, '');
  return `${n}/${uf.trim().toUpperCase()}`;
}

function textoAdvogado(nome: string | null, oab: string | null): string | null {
  if (!nome && !oab) return null;
  if (!oab) return nome;
  return nome ? `${nome} · OAB ${oab}` : `OAB ${oab}`;
}

/**
 * Em quantos processos do lote cada advogado foi escolhido como advogado do
 * CREDOR pela consolidação. Chave por nome normalizado e por OAB normalizada
 * (o DJEN grafa os dois de jeitos diferentes entre publicações).
 */
function advogadosDoCredorNoLote(
  consolidados: ReadonlyMap<string, ProcessoConsolidado>,
): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const proc of consolidados.values()) {
    if (!proc.advogado) continue;
    for (const chave of chavesAdvogado(proc.advogado.nome, proc.advogado.oab)) {
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    }
  }
  return contagem;
}

/** O mesmo, pros advogados que o texto liga ao lado que deve. */
function advogadosDoDevedorNoLote(
  consolidados: ReadonlyMap<string, ProcessoConsolidado>,
): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const proc of consolidados.values()) {
    for (const a of proc.advogadosDevedor ?? []) {
      for (const chave of chavesAdvogado(a.nome, a.oab)) {
        contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
      }
    }
  }
  return contagem;
}

type AdvogadosNoLote = {
  doCredor: ReadonlyMap<string, number>;
  doDevedor: ReadonlyMap<string, number>;
};

function chavesAdvogado(nome: string | null, oab: string | null): string[] {
  const chaves: string[] = [];
  if (nome) chaves.push(`nome:${normalizarNome(nome)}`);
  if (oab && normalizarOab(oab) !== '/') chaves.push(`oab:${normalizarOab(oab)}`);
  return chaves;
}

function diffAdvogado(
  linha: LinhaProspeccaoAtual,
  proc: ProcessoConsolidado,
  lote: AdvogadosNoLote,
): Omit<LinhaDiff, 'id' | 'numero_processo' | 'valor_face' | 'campo'> | null {
  const nomeAntes = limpo(linha.advogado_nome);
  const oabAntes = limpo(linha.advogado_oab);
  const novo = proc.advogado;
  const antes = textoAdvogado(nomeAntes, oabAntes);
  const depois = novo ? textoAdvogado(novo.nome, novo.oab) : null;

  if (!antes && !novo) return null;

  if (!antes) {
    return {
      antes,
      depois,
      tipo: 'corrigir',
      motivo: 'Estava vazio; o texto liga esse advogado ao credor.',
    };
  }

  const mesmoNome =
    !!novo && !!nomeAntes && normalizarNome(nomeAntes) === normalizarNome(novo.nome);
  if (novo && mesmoNome) {
    if (normalizarOab(oabAntes) === normalizarOab(novo.oab)) return null;
    return { antes, depois, tipo: 'corrigir', motivo: 'Mesmo advogado; muda a OAB.' };
  }

  // Só mexe no advogado gravado quando há evidência de que ele é do lado que
  // DEVE: votado como devedor em 2+ processos do lote e nunca escolhido pro
  // credor (os procuradores do Estado/CARHP aparecem em dezenas). Voto de
  // devedor num processo só fica pra conferência: a proximidade no texto erra
  // às vezes (num RO do TRT19 o advogado do trabalhador recorrente saía como do
  // devedor). Sem evidência nenhuma, mantém. A 1ª versão apagava todo advogado
  // que o texto não amarrava ao credor e, nos 126 do TRT19 (23/10), teria
  // jogado fora ~11 contatos do credor e trocado advogados do mesmo time.
  const chaves = chavesAdvogado(nomeAntes, oabAntes);
  const devedorAqui = new Set(
    (proc.advogadosDevedor ?? []).flatMap((a) => chavesAdvogado(a.nome, a.oab)),
  );
  const credorNoLote = Math.max(0, ...chaves.map((c) => lote.doCredor.get(c) ?? 0));
  const devedorNoLote = Math.max(0, ...chaves.map((c) => lote.doDevedor.get(c) ?? 0));
  const atualEhDoDevedor = devedorNoLote >= 2 && credorNoLote === 0;

  if (!atualEhDoDevedor) {
    if (credorNoLote === 0 && chaves.some((c) => devedorAqui.has(c))) {
      return {
        antes,
        depois,
        tipo: 'revisar',
        motivo:
          'O texto deste processo liga esse advogado ao lado que deve, mas só aqui. Confira antes de trocar.',
      };
    }
    if (!novo && credorNoLote > 0) {
      // Fica como está: aparece pra conferência, mas não muda.
      return {
        antes,
        depois,
        tipo: 'revisar',
        motivo: `O texto deste processo não liga esse advogado ao credor, mas ele é advogado do credor em ${credorNoLote === 1 ? 'outro processo' : `${credorNoLote} outros processos`} do lote.`,
      };
    }
    return null;
  }

  if (!novo) {
    // Null de propósito: telefone do outro lado custa mais pro broker que
    // campo vazio — mesma regra do batch.
    return {
      antes,
      depois,
      tipo: 'corrigir',
      motivo: 'É advogado do lado que deve (procurador do ente ou da empresa); melhor vazio.',
    };
  }
  return {
    antes,
    depois,
    tipo: 'corrigir',
    motivo: 'O atual é advogado do lado que deve; o texto liga o novo ao credor.',
  };
}

// ---------------------------------------------------------------------------
// Red flags
// ---------------------------------------------------------------------------

function diffRedFlags(
  linha: LinhaProspeccaoAtual,
  proc: ProcessoConsolidado,
): Omit<LinhaDiff, 'id' | 'numero_processo' | 'valor_face' | 'campo'> | null {
  const atuais = [...new Set(linha.red_flags ?? [])];
  const novas = [...new Set(proc.redFlags)];
  const setAtuais = new Set(atuais);
  const setNovas = new Set(novas);
  const entram = novas.filter((c) => !setAtuais.has(c));
  const saem = atuais.filter((c) => !setNovas.has(c));
  // Mesma lista em outra ordem não é mudança: só o conjunto conta.
  if (entram.length === 0 && saem.length === 0) return null;

  const partes: string[] = [];
  if (entram.length) partes.push(`Entra: ${entram.join(', ')}`);
  if (saem.length) partes.push(`Sai: ${saem.join(', ')}`);
  return {
    antes: atuais.length ? atuais.join(', ') : null,
    depois: novas.length ? novas.join(', ') : null,
    tipo: 'corrigir',
    motivo: partes.join(' · '),
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const ORDEM_CAMPO: Record<CampoDiff, number> = { credor: 0, advogado: 1, red_flags: 2 };

/** Maior valor de face primeiro; sem valor vai pro fim. */
function compararValor(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/**
 * Compara as linhas atuais com o consolidado de cada processo (chave:
 * `numero_processo`, 20 dígitos). Linha cujo processo não está no mapa fica
 * de fora — sem publicação válida não há evidência pra mudar nada.
 *
 * `ctx.peritos` são os peritos citados no lote inteiro: o calculista que o
 * batch antigo gravou como credor num processo às vezes só é chamado de
 * perito no texto de outro. Pelo mesmo motivo `consolidados` deve trazer o
 * lote inteiro: o advogado escolhido pro credor em um processo protege o
 * mesmo advogado de ser apagado em outro (ver `diffAdvogado`).
 *
 * Sai ordenado por valor de face (maior primeiro), depois processo e campo,
 * que é a ordem em que o admin confere.
 */
export function calcularDiffs(
  linhas: readonly LinhaProspeccaoAtual[],
  consolidados: ReadonlyMap<string, ProcessoConsolidado>,
  ctx: { peritos?: ReadonlySet<string> } = {},
): LinhaDiff[] {
  const diffs: LinhaDiff[] = [];
  const lote: AdvogadosNoLote = {
    doCredor: advogadosDoCredorNoLote(consolidados),
    doDevedor: advogadosDoDevedorNoLote(consolidados),
  };
  for (const linha of linhas) {
    const proc = consolidados.get(linha.numero_processo);
    if (!proc) continue;
    const base = {
      id: linha.id,
      numero_processo: linha.numero_processo,
      valor_face: linha.valor_face,
    };
    const credor = diffCredor(linha, proc, ctx.peritos);
    if (credor) diffs.push({ ...base, campo: 'credor', ...credor });
    const advogado = diffAdvogado(linha, proc, lote);
    if (advogado) diffs.push({ ...base, campo: 'advogado', ...advogado });
    const flags = diffRedFlags(linha, proc);
    if (flags) diffs.push({ ...base, campo: 'red_flags', ...flags });
  }
  return diffs.sort(
    (a, b) =>
      compararValor(a.valor_face, b.valor_face) ||
      a.numero_processo.localeCompare(b.numero_processo) ||
      a.id.localeCompare(b.id) ||
      ORDEM_CAMPO[a.campo] - ORDEM_CAMPO[b.campo],
  );
}

/** Contagens pro resumo do diálogo. */
export function resumirDiffs(diffs: readonly LinhaDiff[]): ResumoDiff {
  const resumo: ResumoDiff = {
    credorCorrigir: 0,
    credorRevisar: 0,
    advogado: 0,
    advogadoRevisar: 0,
    redFlags: 0,
  };
  for (const d of diffs) {
    if (d.campo === 'credor') {
      if (d.tipo === 'corrigir') resumo.credorCorrigir++;
      else resumo.credorRevisar++;
    } else if (d.campo === 'advogado') {
      if (d.tipo === 'corrigir') resumo.advogado++;
      else resumo.advogadoRevisar++;
    } else {
      resumo.redFlags++;
    }
  }
  return resumo;
}

/**
 * Impressão digital do diff, pro guarda de corrida: o admin simula, olha a
 * tabela e clica em aplicar; a action recalcula e só grava se o hash bater.
 * Se alguém rodou o batch ou mexeu numa linha no meio, o diff muda e a
 * gravação é recusada — o admin nunca aplica algo que não viu.
 *
 * Determinístico: ordena as linhas antes, então a ordem de entrada não
 * importa. djb2 de 32 bits basta — não é segurança, é detectar mudança.
 */
export function hashDiff(diffs: readonly LinhaDiff[]): string {
  const texto = diffs
    .map((d) => [d.id, d.campo, d.tipo, d.antes ?? '∅', d.depois ?? '∅'].join('\u001f'))
    .sort()
    .join('\u001e');
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = (Math.imul(h, 33) + texto.charCodeAt(i)) | 0;
  return `${diffs.length}-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * O que gravar, linha a linha: UM update por linha, só com as colunas dos
 * diffs 'corrigir'. 'revisar' nunca vira coluna aqui — é a garantia de que o
 * botão de aplicar não troca um credor plausível por outro.
 *
 * Os valores saem do consolidado (não do texto da tela) pra gravar
 * exatamente o que o batch gravaria: nome cru, OAB "1234/AL", códigos na
 * ordem da consolidação.
 */
export function montarAtualizacoes(
  linhas: readonly LinhaProspeccaoAtual[],
  consolidados: ReadonlyMap<string, ProcessoConsolidado>,
  diffs: readonly LinhaDiff[],
): AtualizacaoLinha[] {
  const corrigirPorLinha = new Map<string, Set<CampoDiff>>();
  for (const d of diffs) {
    if (d.tipo !== 'corrigir') continue;
    const campos = corrigirPorLinha.get(d.id) ?? new Set<CampoDiff>();
    campos.add(d.campo);
    corrigirPorLinha.set(d.id, campos);
  }

  const atualizacoes: AtualizacaoLinha[] = [];
  for (const linha of linhas) {
    const campos = corrigirPorLinha.get(linha.id);
    const proc = consolidados.get(linha.numero_processo);
    if (!campos || !proc) continue;

    const colunas: ColunasReconsolidadas = {};
    // Defesa extra: credor nunca é apagado pelo recálculo, mesmo que um diff
    // 'corrigir' com depois null apareça por bug.
    if (campos.has('credor') && proc.credor.nome) colunas.cedente_nome_provavel = proc.credor.nome;
    if (campos.has('advogado')) {
      colunas.advogado_nome = proc.advogado?.nome ?? null;
      colunas.advogado_oab = proc.advogado?.oab ?? null;
    }
    if (campos.has('red_flags')) colunas.red_flags = [...proc.redFlags];

    if (Object.keys(colunas).length === 0) continue;
    atualizacoes.push({
      id: linha.id,
      numero_processo: linha.numero_processo,
      statusLido: linha.status,
      colunas,
    });
  }
  return atualizacoes;
}
