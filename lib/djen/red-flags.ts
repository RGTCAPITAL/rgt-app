/**
 * Red flags detectáveis no texto de uma publicação do DJEN.
 *
 * Os padrões saíram do reconhecimento de 2026-09-21 contra 663 publicações
 * reais de precatório do TJAL, TRT19 e TRF5. Cada padrão traz precisão
 * estimada — não é chute, é medido no corpus.
 *
 * Categorias:
 *   BLOQUEADOR (vermelho)  — cessão consumada, quitação, penhora → não comprar
 *   PRICING    (amarelo)   — precifica diferente (regime especial, dispensa)
 *   NAVEGACIONAL (cinza)   — sinal informativo (trânsito, RPV, herdeiros)
 *
 * O jurídico revê padrão por padrão sem precisar tocar em cliente ou banco.
 */

import type { CategoriaRedFlag, RedFlag } from './types';

export interface RedFlagDef {
  codigo: string;
  descricao: string;
  categoria: CategoriaRedFlag;
  cor: 'vermelho' | 'amarelo' | 'cinza';
  precisao: number;
  regex: RegExp;
  /** Se o match bater aqui também, descarta (evita falso positivo comum). */
  excludeIf?: RegExp;
}

export const REDFLAG_1_CESSAO_AVERBADA: RedFlagDef = {
  codigo: '1',
  descricao: 'Cessão de crédito averbada — substituição do polo ativo',
  categoria: 'BLOQUEADOR',
  cor: 'vermelho',
  precisao: 0.95,
  regex:
    /(substitui[çc][ãa]o\s+do\s+cedente\s+(?:por|pelo|pela)|substitui[çc][ãa]o\s+do\s+polo\s+ativo[^.]{0,80}?cession[áa]ri[oa]|habilita[çc][ãa]o\s+d[eo]\s+cession[áa]ri[oa]|homologa[çc][ãa]o\s+d[ea]\s+cess[ãa]o\s+de\s+cr[ée]dito|cess[ãa]o\s+de\s+cr[ée]dito\s+(?:formalizad|celebrad|realizad))/gi,
};

export const REDFLAG_1A_BOILERPLATE_TJAL: RedFlagDef = {
  codigo: '1a',
  descricao: 'Boilerplate TJAL "Fundo Cessionário no lugar da parte cedente"',
  categoria: 'BLOQUEADOR',
  cor: 'vermelho',
  precisao: 1.0,
  regex: /Fundo\s+Cession[áa]rio\s+no\s+lugar\s+da\s+parte\s+cedente/g,
};

export const REDFLAG_1B_FIGURA_COMO_CEDENTE: RedFlagDef = {
  codigo: '1b',
  descricao: 'Nomeia o credor original que cedeu ("figura como cedente <NOME>")',
  categoria: 'BLOQUEADOR',
  cor: 'vermelho',
  precisao: 0.98,
  regex: /figura\s+como\s+cedente\s+([A-ZÁÊÔÃÕÇÜ][A-Za-záêôãõçüÁÊÔÃÕÇÜ\s.\-']{6,80})/g,
};

export const REDFLAG_1C_ESCRITURA_PUBLICA: RedFlagDef = {
  codigo: '1c',
  descricao: 'Escritura pública de cessão citada',
  categoria: 'BLOQUEADOR',
  cor: 'vermelho',
  precisao: 1.0,
  regex: /escritura\s+p[úu]blica\s+(?:relativa\s+)?(?:de\s+cess[ãa]o|à\s+cess[ãa]o)/gi,
};

export const REDFLAG_2_FIDC_SECURITIZADORA: RedFlagDef = {
  codigo: '2',
  descricao: 'Menção literal a FIDC ou securitizadora',
  categoria: 'BLOQUEADOR',
  cor: 'vermelho',
  precisao: 0.85,
  regex:
    /(FIDC|fundo\s+de\s+investimento\s+em\s+direitos\s+credit[óo]rios|(?:companhia\s+)?securitizadora)/gi,
};

export const REDFLAG_3_PERCENTUAL_CREDITO: RedFlagDef = {
  codigo: '3',
  descricao: 'Percentual sobre o crédito (fraco isolado, forte com contexto)',
  categoria: 'NAVEGACIONAL',
  cor: 'amarelo',
  precisao: 0.6,
  regex:
    /\d{1,3}(?:[,.]\d{1,2})?\s*%\s*(?:\([^)]{1,40}\)\s*)?(?:do\s+(?:valor|montante|cr[ée]dito|principal|precat[óo]rio)|do\s+total|do\s+cr[ée]dito\s+(?:total|exequendo))/gi,
  excludeIf: /honor[áa]rios?\s+(?:advocat[íi]cios?\s+)?contratuais?/i,
};

export const REDFLAG_3A_PERCENTUAL_EM_CESSAO: RedFlagDef = {
  codigo: '3a',
  descricao: 'Percentual dentro de parágrafo de cessão (mais preciso que 3)',
  categoria: 'PRICING',
  cor: 'amarelo',
  precisao: 0.9,
  regex:
    /cess[ãa]o[^.]{0,120}?\d{1,3}(?:[,.]\d{1,2})?\s*%(?:[^.]{0,80}?do\s+(?:valor|cr[ée]dito|montante|precat[óo]rio))?/gi,
};

/**
 * Só sinal FORTE de pagamento: quitação do crédito/precatório, pagamento
 * integral, arquivamento definitivo, extinção pelo pagamento.
 *
 * Até out/2026 esta flag também casava "extinção da execução", "extinção do
 * cumprimento" e "arquivamento dos autos" — e era falso positivo nos 16
 * processos do TRT19 em que aparecia. O texto padrão do tribunal declara "a
 * EXTINÇÃO DA EXECUÇÃO ... aguardando a disponibilização dos valores
 * requisitados", ou seja, sai logo DEPOIS de expedir o precatório e ANTES de
 * pagar. Marcar isso de vermelho escondia justamente os precatórios bons.
 * Essas menções agora são a 4e (aviso amarelo, logo abaixo).
 *
 * O lookbehind derruba a referência ao futuro, mesmo raciocínio do trânsito
 * na flag 9: "mantenham-se os autos sobrestados até a quitação integral do
 * precatório" é texto real do TRT19 e fala de um pagamento que AINDA vai vir.
 *
 * "Satisfação da obrigação" / art. 924, II do CPC ficam de fora de propósito:
 * o TRT19 escreve "Com a expedição do precatório a obrigação foi satisfeita,
 * nos termos do art. 924, II, CPC. Julgo extinta a execução" e, na mesma
 * sentença, manda sobrestar "enquanto se aguarda o pagamento do precatório".
 *
 * "Dou por extint[ao]" fica por precaução: é a fórmula da sentença de
 * extinção cível, que costuma vir com o pagamento logo atrás. A precisão não
 * foi remedida depois do corte — no corpus atual a flag não aparece mais.
 */
export const REDFLAG_4_QUITACAO_ARQUIVAMENTO: RedFlagDef = {
  codigo: '4',
  descricao: 'Quitação, pagamento integral ou arquivamento definitivo',
  categoria: 'BLOQUEADOR',
  cor: 'vermelho',
  precisao: 0.9,
  regex:
    /((?<!\b(?:at[ée]|para|ap[óo]s|antes\s+d[aeo]|quando\s+d[aeo]|aguard\w*(?:-se)?)\s+(?:[oa]\s+)?)(?:quita[çc][ãa]o\s+(?:integral\s+|total\s+)?d[oa]\s+(?:cr[ée]dito|precat[óo]rio)|pagament[oe]\s+integral\s+(?:do\s+cr[ée]dito|efetuad|realizad))|quitad[oa]\s+(?:integralmente|o\s+cr[ée]dito|o\s+precat)|(?:cr[ée]dito|precat[óo]rio)\s+(?:foi\s+)?(?:integralmente\s+)?quitad[oa]|arquivament[oe]\s+definitiv[oa]|arquiv(?:em|e)-se\s+(?:os\s+autos\s+)?definitivamente|(?:extin[çc][ãa]o(?:\s+d[ao]\s+(?:execu[çc][ãa]o|cumprimento(?:\s+de\s+senten[çc]a)?))?|extint[ao]\s+a\s+execu[çc][ãa]o),?\s+(?:pelo|pela|em\s+raz[ãa]o\s+d[oa]|ante\s+[oa]|diante\s+d[oa])\s+(?:pagamento|quita[çc][ãa]o)|dou\s+por\s+extint[ao])/gi,
};

/**
 * Extinção da execução/cumprimento ou arquivamento dos autos citado SEM sinal
 * forte de pagamento. No TRT19 isso é quase sempre o texto padrão pós-ofício
 * (processo sobrestado aguardando o pagamento do precatório) — mas um dos 16
 * casos medidos era prescrição intercorrente, que extingue SEM pagar. Por isso
 * a menção não pode sumir: vira aviso pra ler a publicação antes de ligar.
 *
 * Quando o mesmo trecho já tem sinal forte (a 4 bate na vizinhança), a 4e é
 * descartada pelo `excludeIf` — o alerta grave já diz tudo.
 *
 * A precisão mede a detecção da menção (alta), não o risco: nos 16 processos,
 * só 1 era extinção de verdade.
 */
export const REDFLAG_4E_EXTINCAO_CITADA: RedFlagDef = {
  codigo: '4e',
  descricao:
    'Extinção da execução/cumprimento ou arquivamento dos autos citado, sem menção a pagamento',
  categoria: 'NAVEGACIONAL',
  cor: 'amarelo',
  precisao: 0.95,
  regex:
    /(extin[çc][ãa]o\s+d[ao]\s+(?:execu[çc][ãa]o|cumprimento)|extint[ao]\s+(?:a\s+execu[çc][ãa]o|o\s+cumprimento)|arquivament[oe]?\s+dos?\s+autos)/gi,
  // Sem a flag `g`: excludeIf roda com .test() e não pode carregar lastIndex
  excludeIf: new RegExp(REDFLAG_4_QUITACAO_ARQUIVAMENTO.regex.source, 'i'),
};

export const REDFLAG_5_SUSPENSO: RedFlagDef = {
  codigo: '5',
  descricao: 'Processo suspenso ou sobrestado',
  categoria: 'NAVEGACIONAL',
  cor: 'amarelo',
  precisao: 0.9,
  regex:
    /(processo\s+(?:est[áa]|encontra-se)?\s*suspens[oa]|(?:determino|defiro)\s+a\s+suspens[ãa]o|sobrestad[oa]|sobrestament[oe])/gi,
};

export const REDFLAG_6_REGIME_ESPECIAL: RedFlagDef = {
  codigo: '6',
  descricao: 'Regime especial de pagamento / EC 99/109/114/126 / CGP',
  categoria: 'PRICING',
  cor: 'amarelo',
  precisao: 0.9,
  regex:
    /(regime\s+especial\s+de\s+pagament|adeso\s+ao\s+regime|EC\s*n?[º.]*\s*(?:99|109|114|126)(?:\/20\d{2})?|Emenda\s+Constitucional\s+(?:99|109|114|126)|art\.?\s*10[01]\s+d[ao]?\s*ADCT|CGP\b)/gi,
};

export const REDFLAG_7_HERDEIROS_OBITO: RedFlagDef = {
  codigo: '7',
  descricao: 'Habilitação de herdeiros, espólio, óbito',
  categoria: 'NAVEGACIONAL',
  cor: 'amarelo',
  precisao: 0.92,
  regex:
    /(habilita[çc][ãa]o\s+de\s+herdeir|invent[áa]riant|esp[óo]lio\s+de|fal[eê]cid[oa]|de\s+cujus|[óo]bito\s+em)/gi,
};

export const REDFLAG_8_PENHORA_CREDITO: RedFlagDef = {
  codigo: '8',
  descricao: 'Penhora/arresto sobre o crédito (evento raro; regex pronto)',
  categoria: 'BLOQUEADOR',
  cor: 'vermelho',
  precisao: 0.9,
  regex:
    /(penhora\s+(?:do\s+cr[ée]dito|sobre\s+o\s+cr[ée]dito|sobre\s+o\s+precat)|arresto\s+(?:do\s+cr[ée]dito|do\s+precat)|indisponibilidade\s+do\s+cr[ée]dito|constri[çc][ãa]o\s+do\s+cr[ée]dito)/gi,
};

export const REDFLAG_8A_BLOQUEIO_DEVEDOR: RedFlagDef = {
  codigo: '8a',
  descricao: 'Bloqueio/sequestro de conta do devedor (oportunidade)',
  categoria: 'PRICING',
  cor: 'amarelo',
  precisao: 0.92,
  regex:
    /(bloqueio\s+(?:d[ao]s?\s+contas?|de\s+cr[ée]dito|do\s+levantamento)|sequestro\s+d[eo]\s+(?:valor|verba|numer[áa]rio))/gi,
};

/**
 * "Após o trânsito em julgado" é a frase mais comum de sentença e fala do
 * futuro: o processo ainda NÃO transitou. Sem o lookbehind, o TRT19
 * 0000952-62.2024.5.19.0008 ganhava selo de trânsito com duas publicações que
 * só diziam "após o trânsito em julgado" (RGT-95). Pra precatório é o pior
 * erro possível — trânsito é o portão do ofício requisitório.
 */
export const REDFLAG_9_TRANSITO_JULGADO: RedFlagDef = {
  codigo: '9',
  descricao: 'Trânsito em julgado certificado',
  categoria: 'NAVEGACIONAL',
  cor: 'cinza',
  precisao: 0.95,
  regex:
    /((?<!\b(?:ap[óo]s|depois\s+d[oe]|at[ée]|antes\s+d[oe]|com|quando\s+d[oe]|aguard\w*(?:-se)?)\s+(?:o\s+)?)tr[âa]nsito\s+em\s+julgad[oa]|certifica[çc][ãa]o\s+do\s+tr[âa]nsito|certid[ãa]o\s+de\s+tr[âa]nsito|transitad[oa]\s+em\s+julgad[oa])/gi,
};

export const REDFLAG_10_RECURSO_PENDENTE: RedFlagDef = {
  codigo: '10',
  descricao: 'Recurso pendente (RE, REsp, agravo, embargos)',
  categoria: 'NAVEGACIONAL',
  cor: 'amarelo',
  precisao: 0.8,
  regex:
    /(recurso\s+(?:extraordin[áa]ri[oa]|especial|inominad[oa])|agravo\s+de\s+instrumento|embargos\s+(?:de\s+declara[çc][ãa]o|infringentes|do\s+devedor|à\s+execu[çc][ãa]o|de\s+terceiro)|impugna[çc][ãa]o\s+ao\s+cumprimento)/gi,
};

export const REDFLAG_X1_OFICIO_REQUISITORIO: RedFlagDef = {
  codigo: 'X1',
  descricao: 'Ofício requisitório expedido / autuação de precatório',
  categoria: 'NAVEGACIONAL',
  cor: 'cinza',
  precisao: 0.9,
  regex:
    /(of[íi]cio\s+requisit[óo]ri|requisi[çc][ãa]o\s+de\s+pagamento|expedi[çc][ãa]o\s+do\s+of[íi]cio|autua[çc][ãa]o\s+do\s+precat[óo]ri|inscri[çc][ãa]o\s+do\s+precat[óo]ri)/gi,
};

export const REDFLAG_X2_DESAGIO_ACORDO: RedFlagDef = {
  codigo: 'X2',
  descricao: 'Deságio / acordo direto / leilão / câmara de conciliação',
  categoria: 'PRICING',
  cor: 'amarelo',
  precisao: 0.95,
  regex:
    /(des[áa]gio|acordo\s+direto\s+com\s+des[áa]gio|leil[ãa]o\s+de\s+precat|edital\s+(?:de\s+acordo\s+direto|de\s+concilia[çc][ãa]o)|c[âa]mara\s+de\s+concilia[çc][ãa]o|proposta\s+de\s+acordo)/gi,
};

export const REDFLAG_X3_COMPENSACAO_TRIBUTARIA: RedFlagDef = {
  codigo: 'X3',
  descricao: 'Compensação com dívida ativa / retenção de IR / contribuição',
  categoria: 'PRICING',
  cor: 'amarelo',
  precisao: 0.92,
  regex:
    /(compensa[çc][ãa]o\s+(?:tribut[áa]ri|com\s+d[ée]bito)|d[íi]vida\s+ativa|reten[çc][ãa]o\s+(?:na\s+fonte|de\s+IR)|imposto\s+de\s+renda\s+(?:retido|na\s+fonte)|contribui[çc][ãa]o\s+previdenci[áa]ria)/gi,
};

export const REDFLAG_X4_RPV: RedFlagDef = {
  codigo: 'X4',
  descricao: 'RPV ou conversão em precatório',
  categoria: 'NAVEGACIONAL',
  cor: 'cinza',
  precisao: 0.95,
  regex: /(\bRPV\b|requisi[çc][ãa]o\s+de\s+pequeno\s+valor|convers[ãa]o\s+em\s+precat)/gi,
};

export const REDFLAG_X5_LOA_EXERCICIO: RedFlagDef = {
  codigo: 'X5',
  descricao: 'Exercício orçamentário citado (extrair ano para pricing)',
  categoria: 'PRICING',
  cor: 'amarelo',
  precisao: 0.92,
  regex:
    /(exerc[íi]cio\s+de\s+\d{4}|LOA\b|or[çc]amento\s+de\s+\d{4}|inclus[ãa]o\s+no\s+or[çc]ament|pago\s+em\s+\d{4}|proposta\s+or[çc]ament[áa]ria)/gi,
};

export const REDFLAG_X7_DISPENSA_ANUENCIA: RedFlagDef = {
  codigo: 'X7',
  descricao: 'Dispensa de anuência do devedor (boilerplate art. 100 §14 CF)',
  categoria: 'BLOQUEADOR',
  cor: 'vermelho',
  precisao: 1.0,
  regex:
    /independentemente\s+d[ea]\s+(?:anu[êe]ncia|concord[âa]ncia)\s+d[oa]?\s*(?:devedor|entidade)/gi,
};

export const TODAS_REDFLAGS: RedFlagDef[] = [
  REDFLAG_1_CESSAO_AVERBADA,
  REDFLAG_1A_BOILERPLATE_TJAL,
  REDFLAG_1B_FIGURA_COMO_CEDENTE,
  REDFLAG_1C_ESCRITURA_PUBLICA,
  REDFLAG_2_FIDC_SECURITIZADORA,
  REDFLAG_3_PERCENTUAL_CREDITO,
  REDFLAG_3A_PERCENTUAL_EM_CESSAO,
  REDFLAG_4_QUITACAO_ARQUIVAMENTO,
  REDFLAG_4E_EXTINCAO_CITADA,
  REDFLAG_5_SUSPENSO,
  REDFLAG_6_REGIME_ESPECIAL,
  REDFLAG_7_HERDEIROS_OBITO,
  REDFLAG_8_PENHORA_CREDITO,
  REDFLAG_8A_BLOQUEIO_DEVEDOR,
  REDFLAG_9_TRANSITO_JULGADO,
  REDFLAG_10_RECURSO_PENDENTE,
  REDFLAG_X1_OFICIO_REQUISITORIO,
  REDFLAG_X2_DESAGIO_ACORDO,
  REDFLAG_X3_COMPENSACAO_TRIBUTARIA,
  REDFLAG_X4_RPV,
  REDFLAG_X5_LOA_EXERCICIO,
  REDFLAG_X7_DISPENSA_ANUENCIA,
];

/**
 * Roda todos os padrões contra o texto de uma publicação e devolve os hits.
 * O trecho gravado é o **match literal**; o contexto são ~100 chars ao redor
 * pra o revisor humano ver antes/depois sem reabrir o processo inteiro.
 */
export function detectarRedFlags(texto: string): RedFlag[] {
  if (!texto) return [];

  const flags: RedFlag[] = [];

  for (const def of TODAS_REDFLAGS) {
    // regex.g mantém lastIndex — clona pra evitar estado compartilhado
    const re = new RegExp(def.regex.source, def.regex.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) !== null) {
      const trecho = m[0];

      // Filtro de falso positivo: se o match tem contexto suspeito, descarta
      if (def.excludeIf) {
        const ctxBusca = texto.slice(Math.max(0, m.index - 60), m.index + trecho.length + 60);
        if (def.excludeIf.test(ctxBusca)) continue;
      }

      const inicio = Math.max(0, m.index - 100);
      const fim = Math.min(texto.length, m.index + trecho.length + 100);
      const contexto = texto.slice(inicio, fim).replace(/\s+/g, ' ').trim();

      flags.push({
        codigo: def.codigo,
        categoria: def.categoria,
        cor: def.cor,
        precisao: def.precisao,
        trecho,
        contexto,
      });

      // Evita loop infinito quando regex.g matcha string vazia
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  return flags;
}

// ---- Extractors estruturados ----

const REGEX_CREDOR_MASCARADO = /^(?:[A-ZÁÊÔÃÕÇÜ]\.\s*){2,}[A-ZÁÊÔÃÕÇÜ]\.?$/;

/**
 * Detecta se o nome do polo ativo veio mascarado por segredo do tribunal
 * (ex "E.A.D.O." em vez do nome completo). Comum em ~40% dos precatórios
 * trabalhistas — quando true, o canal comercial vira o advogado.
 */
export function nomeEstaMascarado(nome: string): boolean {
  return REGEX_CREDOR_MASCARADO.test(nome.trim());
}

const ANCORAS_CESSIONARIO: RegExp[] = [
  /substitui[çc][ãa]o\s+do\s+cedente\s+por\s+([A-ZÁÊÔÃÕÇÜ][^\n.,]{4,80})/gi,
  /([A-ZÁÊÔÃÕÇÜ][A-Za-záêôãõçüÁÊÔÃÕÇÜ0-9\s.\-']{6,80})\s+informou\s+acerca\s+da\s+celebra[çc][ãa]o\s+do\s+Termo\s+de\s+Cess[ãa]o/gi,
  /cession[áa]ri[oa]\s*:?\s*([A-ZÁÊÔÃÕÇÜ][^\n.,]{4,80})/gi,
];

const REGEX_CREDOR_CEDENTE_ANCORA =
  /figura\s+como\s+cedente\s+([A-ZÁÊÔÃÕÇÜ][A-Za-záêôãõçüÁÊÔÃÕÇÜ\s.\-']{6,80})/i;

const REGEX_DESAGIO =
  /cess[ãa]o[^.]{0,120}?(\d{1,3}(?:[,.]\d{1,2})?)\s*%(?:[^.]{0,80}?do\s+(?:valor|cr[ée]dito|montante|precat[óo]rio))?/i;

const REGEX_ANO_LOA =
  /(?:exerc[íi]cio\s+de\s+|or[çc]amento\s+de\s+|pago\s+em\s+|LOA[^\d]{0,20})(\d{4})/i;

export interface ExtracaoTexto {
  cessionario?: string;
  credorCedente?: string;
  desagioPercentual?: number;
  anoOrcamentario?: number;
}

export function extrairFatos(texto: string): ExtracaoTexto {
  if (!texto) return {};

  const res: ExtracaoTexto = {};

  for (const re of ANCORAS_CESSIONARIO) {
    const reClone = new RegExp(re.source, re.flags);
    const m = reClone.exec(texto);
    if (m?.[1]) {
      res.cessionario = m[1].trim();
      break;
    }
  }

  const mCedente = REGEX_CREDOR_CEDENTE_ANCORA.exec(texto);
  if (mCedente?.[1]) res.credorCedente = mCedente[1].trim();

  const mDesagio = REGEX_DESAGIO.exec(texto);
  if (mDesagio?.[1]) {
    const num = Number(mDesagio[1].replace(',', '.'));
    if (Number.isFinite(num) && num > 0 && num <= 100) res.desagioPercentual = num;
  }

  const mAno = REGEX_ANO_LOA.exec(texto);
  if (mAno?.[1]) {
    const ano = Number(mAno[1]);
    // Janela sensata: precatório de LOA 2020-2050
    if (ano >= 2020 && ano <= 2050) res.anoOrcamentario = ano;
  }

  return res;
}

/**
 * `<br>` do HTML pra newline. Guarda cru no banco (raw); converte só quando
 * for exibir ou indexar semanticamente.
 */
export function sanitizarTexto(texto: string): string {
  return texto.replace(/<br\s*\/?>/gi, '\n').trim();
}

// ---- Lookup pra UI ----

const LOOKUP: Map<string, RedFlagDef> = new Map(TODAS_REDFLAGS.map((f) => [f.codigo, f]));

/**
 * Descrições em português "normal" pra hover na UI. A `descricao` do def é
 * técnica (pro jurídico ler); estas são pro broker/gestão que não é advogado.
 * Faltar aqui não é bug: cai no fallback pra descricao técnica.
 */
const DESCRICOES_HUMANAS: Record<string, string> = {
  '1': 'Alguém já comprou este crédito. Não dá pra oferecer proposta.',
  '1a': 'Boilerplate do TJAL: fundo já foi habilitado no lugar do credor. Não comprar.',
  '1b': 'O texto nomeia quem vendeu o crédito. Cessão consumada.',
  '1c': 'Escritura pública de cessão foi citada. Cessão consumada.',
  '2': 'FIDC ou securitizadora aparece no processo. Concorrência já entrou.',
  '3': '"% do crédito" mencionado. Pode ser cessão parcial — vale checar.',
  '3a': 'Percentual de crédito EM cessão. Negociação em andamento.',
  '4': 'O texto fala em quitação, pagamento integral ou arquivamento definitivo. Confira se já foi pago.',
  '4e': 'Fala em extinção da execução. No TRT19 isso costuma sair logo depois da expedição do precatório, com o processo aguardando o pagamento — mas também pode ser prescrição. Leia a publicação antes de ligar.',
  '5': 'Execução suspensa. Vai demorar mais pra receber.',
  '6': 'Regime especial de pagamento — precifica diferente do normal.',
  '7': 'Credor faleceu, herdeiros no processo. Negociação com espólio.',
  '8': 'Penhora sobre o crédito. Parte do valor tem destino comprometido.',
  '8a': 'Bloqueio contra o ente devedor. Sinal POSITIVO — pressão pra pagar.',
  '9': 'Trânsito em julgado — pode virar precatório definitivo.',
  '10': 'Recurso pendente. Ainda não é definitivo.',
  X1: 'Ofício requisitório expedido — precatório em formação.',
  X2: 'Deságio ou acordo formal citado no texto.',
  X3: 'Compensação tributária discutida no processo.',
  X4: 'RPV (mini-precatório): paga rápido, mas o teto de valor é baixo.',
  X5: 'Ano do exercício orçamentário/LOA identificado no texto.',
  X7: 'Dispensa de anuência do devedor (boilerplate art. 100 §14 CF).',
};

export interface RedFlagInfo {
  codigo: string;
  descricao: string;
  descricaoHumana: string;
  categoria: CategoriaRedFlag;
  cor: 'vermelho' | 'amarelo' | 'cinza';
}

/**
 * Devolve info agregada pra render — junta o def (categoria/cor) com a
 * descrição humana. Códigos desconhecidos caem em cinza/'código X detectado'
 * pra a UI nunca engolir o sinal, mesmo se o catálogo mudar no server.
 */
export function infoRedFlag(codigo: string): RedFlagInfo {
  const def = LOOKUP.get(codigo);
  if (!def) {
    return {
      codigo,
      descricao: `Código ${codigo} (desconhecido)`,
      descricaoHumana: `Padrão "${codigo}" detectado mas ainda não catalogado nesta versão.`,
      categoria: 'NAVEGACIONAL',
      cor: 'cinza',
    };
  }
  return {
    codigo,
    descricao: def.descricao,
    descricaoHumana: DESCRICOES_HUMANAS[codigo] ?? def.descricao,
    categoria: def.categoria,
    cor: def.cor,
  };
}

// ---- Gravidade pra fila de prospecção ----

/**
 * Códigos que, sozinhos, tiram o precatório da mão do broker: alguém já
 * comprou (cessão 1/1a/1b/1c, FIDC 2, percentual dentro de cessão 3a), já foi
 * pago (4) ou o crédito está penhorado (8).
 *
 * Não é o mesmo que `categoria === 'BLOQUEADOR'`, de propósito:
 *   - 3a é PRICING no catálogo (o percentual precifica), mas só aparece em
 *     parágrafo de cessão — é negociação em andamento ou cessão feita.
 *   - X7 é BLOQUEADOR/vermelho no catálogo, mas na prática é o boilerplate do
 *     art. 100 §14 CF que sai em qualquer expedição de ofício. Tratar como
 *     grave marcaria quase todo precatório do TRT19.
 *   - 4e é só aviso: no TRT19 a extinção da execução sai antes do pagamento.
 */
export const CODIGOS_ALERTA_GRAVE: ReadonlySet<string> = new Set([
  '1',
  '1a',
  '1b',
  '1c',
  '2',
  '3a',
  '4',
  '8',
]);

/** True quando algum código da lista é alerta grave (desconhecido não conta). */
export function temAlertaGrave(codigos: readonly string[]): boolean {
  return codigos.some((c) => CODIGOS_ALERTA_GRAVE.has(c));
}

/**
 * Peso de exibição: grave primeiro (é o que impede a ligação), depois o ofício
 * requisitório (o sinal POSITIVO que o broker procura), depois avisos
 * amarelos, e o resto (cinza, X7, desconhecido) no fim.
 */
function pesoExibicao(codigo: string): number {
  if (CODIGOS_ALERTA_GRAVE.has(codigo)) return 0;
  if (codigo === 'X1') return 1;
  if (LOOKUP.get(codigo)?.cor === 'amarelo') return 2;
  return 3;
}

/**
 * Ordena códigos pra UI. A tabela corta nas primeiras flags, então o alerta
 * grave não pode ficar escondido atrás do "+N". Sort estável: dentro do mesmo
 * peso fica a ordem de entrada. Devolve cópia — não muta a entrada.
 */
export function ordenarFlagsParaExibir(codigos: readonly string[]): string[] {
  return [...codigos].sort((a, b) => pesoExibicao(a) - pesoExibicao(b));
}
