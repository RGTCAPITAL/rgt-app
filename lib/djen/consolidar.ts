/**
 * Consolida as publicações do DJEN de UM processo em três fatos pra fila de
 * prospecção: quem é o credor, quem é o advogado DELE e quais red flags pesam.
 *
 * Por que isso existe: o batch antigo pegava o 1º destinatário do polo A e o
 * `advogados[0]` da publicação mais recente. Medido nos 128 precatórios do
 * TRT19 em 23/10, isso errou o credor em 21 processos (7 "ESTADO DE ALAGOAS",
 * 12 peritos, 1 Caixa, 1 sociedade de advogados) e o advogado em ~61. Os dois
 * erros têm a mesma raiz: o DJEN lista destinatários e advogados em ORDEM
 * ALFABÉTICA, misturando os dois lados do processo. Em recurso o ente aparece
 * no polo A (é ele quem recorre), e o perito contábil entra como polo A em
 * todo processo onde fez os cálculos.
 *
 * O nome certo está no cabeçalho que o PJe gera no topo de cada publicação
 * ("EXEQUENTE: NOME  EXECUTADO: ..."). Por isso o cabeçalho pesa muito mais que
 * o polo, e o polo vira só desempate. Tudo aqui é função pura — sem banco, sem
 * rede — pra rodar em lote e ser testado com fixture.
 */

import { classificarDevedor, normalizarNome } from './devedor-publico';
import type { Publicacao, RedFlag } from './types';

export type CredorConsolidado = {
  /** Nome pro broker. Espólio sai como "NOME (ESPÓLIO)". Null se só sobrou parte descartada. */
  nome: string | null;
  /** De onde veio a evidência mais forte do vencedor. Null quando `nome` é null. */
  fonte: 'cabecalho' | 'recurso' | 'polo' | null;
  /**
   * O cabeçalho de credor do vencedor diz "E OUTROS (n)": ação plúrima, o
   * crédito é dividido. Cabeçalho de recurso não conta — lá o "E OUTROS (1)"
   * costuma ser o co-devedor ("AGRAVADO: FULANO E OUTROS (1)" com a estatal).
   */
  plurima: boolean;
  /** O cabeçalho diz "(ESPÓLIO DE)": quem negocia é o inventariante/herdeiros. */
  espolio: boolean;
  /** Demais candidatos válidos (litisconsortes prováveis), do mais forte pro mais fraco. */
  outros: string[];
};

/** `oab` no formato "1234/AL", igual o batch grava desde o começo. */
export type AdvogadoConsolidado = { nome: string; oab: string } | null;

export type MotivoNaoCredor =
  'ente público' | 'empresa, escritório ou sindicato' | 'advogado do processo' | 'perito';

// ---------------------------------------------------------------------------
// Pesos (ver o cabeçalho do arquivo pro porquê)
// ---------------------------------------------------------------------------

/** "EXEQUENTE/AUTOR/RECLAMANTE/REQUERENTE: NOME" — gerado pelo PJe, é o credor. */
const PESO_CABECALHO = 10;
/**
 * "AGRAVADO/RECORRIDO: NOME" — em precatório quem recorre é quase sempre o
 * ente, então o recorrido costuma ser o credor. Pesa menos porque o
 * trabalhador também recorre (ROT), e aí ele é o RECORRENTE.
 */
const PESO_RECURSO = 3;
/** Destinatário do polo A sem máscara: sinal fraco, só desempata. */
const PESO_POLO = 1;

/** Quantos caracteres antes do nome do advogado procurar a parte que ele representa. */
const JANELA_ADVOGADO = 300;

// ---------------------------------------------------------------------------
// Gramática de nome em maiúsculas
// ---------------------------------------------------------------------------

const MAI = 'A-ZÀ-ÖØ-Þ';
const MIN = 'a-zß-öø-ÿ';

/**
 * Palavra toda em maiúscula. A barra e o ponto entram por causa de "S/A" e
 * "S.A." — sem eles "SERVICOS ... S/A SERVEAL" viraria um nome cortado. O
 * lookahead barra "Quanto", "Dr." etc: palavra com minúscula não é nome de
 * parte — e tem que barrar maiúscula também, senão o motor recua e aceita
 * "ES" como palavra inteira dentro de "ESPóLIO".
 */
const PALAVRA = `[${MAI}][${MAI}'’./&-]*(?![${MAI}${MIN}])`;

/**
 * Sequência de palavras separadas por UM espaço (ou " - "). Dois espaços
 * separam campos no cabeçalho do PJe, então param a captura. "(ESPÓLIO DE)" e
 * "(3)" entram como palavra pra não quebrar o "E OUTROS (3)" que vem depois.
 */
const SEQUENCIA_NOME = `${PALAVRA}(?:(?: | - )(?:${PALAVRA}|\\(ESP[ÓO]LIO(?: DE)?\\)|\\(\\d+\\)))*`;

/** "RECLAMANTE(S)", "AUTOR(A)", "RECLAMADA(O)/RECORRIDO(A)". */
const SUFIXO_ROTULO = '(?:\\((?:A|O|S|AS|OS|ES)\\))*(?:\\/[A-Z()]+)?';

/**
 * Rótulos de credor. Os longos aceitam vir colados na palavra anterior porque
 * o TRT19 às vezes perde o espaço ("ALAGOASAGRAVADOS:", "SANTOSRECORRIDO:");
 * AUTOR é curto demais pra isso ("COAUTOR").
 */
const RE_CAB_CREDOR = new RegExp(
  `(?:(?<![${MAI}${MIN}])AUTOR(?:A|ES|AS)?|EXEQUENTES?|RECLAMANTES?|REQUERENTES?)${SUFIXO_ROTULO}\\s*:\\s*(${SEQUENCIA_NOME})`,
  'g',
);

const RE_CAB_RECURSO = new RegExp(
  `(?:AGRAVAD[OA]S?|RECORRID[OA]S?)${SUFIXO_ROTULO}\\s*:\\s*(${SEQUENCIA_NOME})`,
  'g',
);

/**
 * Rótulos do outro lado, usados só no voto do advogado. EXECUTADO/RÉU/RECLAMADO
 * marcam devedor; AGRAVANTE/RECORRENTE dependem de quem é a parte.
 */
const RE_CAB_DEVEDOR = new RegExp(
  `(EXECUTAD[OA]S?|(?<![${MAI}${MIN}])R[ÉE]US?|RECLAMAD[OA]S?|AGRAVANTES?|RECORRENTES?)${SUFIXO_ROTULO}\\s*:\\s*(${SEQUENCIA_NOME})`,
  'g',
);

/**
 * Cabeçalho sem rótulo, que o PJe gera em parte das intimações:
 * "0000123-45.2024.5.19.0004  : NOME (ESPÓLIO DE) E OUTROS (3)  : DEVEDOR".
 * Dois espaços antes do ":" é o que separa isso de um "Recorrente(s):" do corpo.
 */
const RE_CAB_SEM_ROTULO = new RegExp(
  `(?:^|\\s{2,}):\\s*(${SEQUENCIA_NOME})(?:\\s{2,}:\\s*(${SEQUENCIA_NOME}))?`,
);

/**
 * Onde o nome da parte acaba e começa o próximo campo, quando o tribunal usou
 * espaço simples ("AGRAVANTE: ESTADO DE ALAGOAS AGRAVADO: ..."). Os rótulos
 * longos cortam mesmo colados na palavra anterior; os curtos (RÉU, ADV.) só
 * como palavra inteira, senão "ANDREU" perderia o fim.
 */
const RE_CAUDA = new RegExp(
  `\\s*(?:(?<![${MAI}])(?:R[ÉE]US?|AUTOR(?:A|ES|AS)?|ADV\\.?|OAB|CPF|CNPJ|DRA?\\.?|PERIT[OA]S?)(?![${MAI}])` +
    `|ADVOGAD|EXECUTAD|EXEQUENT|AGRAVANT|AGRAVAD|RECORRENT|RECORRID|RECLAMAD|RECLAMANT|REQUERENT|REQUERID` +
    `|EMBARGANT|EMBARGAD|PROCESSO|RELATOR|PROCURADOR|DESTINAT[ÁA]RI|INTIMA[ÇC][ÃA]O|NOTIFICA[ÇC][ÃA]O|INTERESSAD|CUSTOS LEGIS)`,
);

const RE_E_OUTROS = /(?:^|\s)E OUTR[OA]S?(?:\s|$|\().*$/;
const RE_ESPOLIO_SUFIXO = /\s*\(ESP[ÓO]LIO(?: DE)?\)\s*/g;
/** "ESPÓLIO DE NOME" ou "INVENTARIANTE ESPÓLIO DE NOME": o crédito é do falecido. */
const RE_ESPOLIO_PREFIXO = /(?:^|\s)ESP[ÓO]LIO D[EOA]\s+(.+)$/;

/** Placeholders que aparecem no lugar do nome ("RECORRIDOS: OS MESMOS"). */
const NOMES_VAZIOS: ReadonlySet<string> = new Set(['OS MESMOS', 'AS MESMAS', 'O MESMO', 'A MESMA']);

interface NomeAnalisado {
  /** Como veio no texto, sem as caudas e sem o marcador de espólio. */
  nome: string;
  /** `normalizarNome(nome)` — chave pra juntar a mesma pessoa entre publicações. */
  chave: string;
  espolio: boolean;
  plurima: boolean;
}

/**
 * Limpa um nome capturado. A ordem importa: primeiro corta o próximo rótulo,
 * depois o "E OUTROS", e só então o espólio — "(ESPÓLIO DE)" fica ANTES do
 * "E OUTROS" no texto real e não pode esconder a plúrima.
 */
function analisarNome(bruto: string): NomeAnalisado | null {
  let s = corrigirCaixaLegada(bruto).replace(/\s+/g, ' ').trim();

  const cauda = RE_CAUDA.exec(s);
  if (cauda) s = s.slice(0, cauda.index);

  let plurima = false;
  const outros = RE_E_OUTROS.exec(s);
  if (outros) {
    plurima = true;
    s = s.slice(0, outros.index);
  }

  let espolio = false;
  if (/\(ESP[ÓO]LIO(?: DE)?\)/.test(s)) {
    espolio = true;
    s = s.replace(RE_ESPOLIO_SUFIXO, ' ');
  }
  const prefixo = RE_ESPOLIO_PREFIXO.exec(s);
  if (prefixo) {
    espolio = true;
    s = prefixo[1]!;
  }

  s = s
    .replace(/^[\s.,;:\-–]+|[\s.,;:\-–]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Uma palavra só é sigla ("SINDAGRO") ou nome mascarado ("E.A.D.O.") — não
  // dá pra prospectar nenhum dos dois pelo nome. A máscara também vem com
  // espaço ("J. M. C. DOS S."), e aí são as iniciais soltas que denunciam.
  const palavras = s.split(' ');
  if (palavras.length < 2) return null;
  const iniciais = palavras.filter((p) => p.replace(/\./g, '').length === 1).length;
  if (iniciais >= 2 && iniciais * 2 >= palavras.length) return null;
  const chave = normalizarNome(s);
  if (NOMES_VAZIOS.has(chave)) return null;
  return { nome: s, chave, espolio, plurima };
}

/**
 * O DJEN herdou capitalização quebrada em acento ("AçãO", "ESPóLIO"). Sobe a
 * caixa da letra acentuada quando ela está entre maiúsculas, senão o nome
 * para no meio da palavra.
 */
function corrigirCaixaLegada(s: string): string {
  return s.replace(/(?<=[A-ZÀ-ÖØ-Þ])[à-öø-þ]+(?=[A-ZÀ-ÖØ-Þ])/g, (m) => m.toUpperCase());
}

/** Tira o HTML e o espaço não separável que o DJEN manda no `texto`. */
function prepararTexto(texto: string | null | undefined): string {
  return corrigirCaixaLegada(texto ?? '')
    .replace(/<br\s*\/?>/gi, '  ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\t\r\n]+/g, '  ');
}

/** Universo da consolidação: publicação cancelada não diz nada sobre o processo. */
function publicacoesValidas(pubs: readonly Publicacao[]): Publicacao[] {
  return pubs.filter((p) => !p.cancelamento && !p._raw?.data_cancelamento);
}

/** Mais recente primeiro. Não confia na ordem de entrada (a API já ordena, a fixture não). */
function porRecencia(pubs: readonly Publicacao[]): Publicacao[] {
  return [...pubs].sort((a, b) => {
    if (a.dataDisponibilizacao !== b.dataDisponibilizacao) {
      return a.dataDisponibilizacao < b.dataDisponibilizacao ? 1 : -1;
    }
    return b.id - a.id;
  });
}

// ---------------------------------------------------------------------------
// Quem NÃO pode ser credor
// ---------------------------------------------------------------------------

/**
 * Marcas de pessoa jurídica. Roda sobre o nome normalizado (sem acento).
 * Nunca "SA" solto: Sá é sobrenome ("JOAO DE SA TEIXEIRA" é credor real do
 * corpus). "ME" só no fim, como em "LTDA - ME" — no meio pode ser outra coisa.
 */
const RE_PESSOA_JURIDICA = new RegExp(
  '\\b(?:LTDA|EIRELI|EPP|CIA|COMPANHIA|SINDICATO|ASSOCIACAO|COOPERATIVA|FUNDO|FIDC|SECURITIZADORA' +
    '|PRECATORIOS|BANCO|TRIBUNAL|MINISTERIO PUBLICO|SECRETARIA|PROCURADORIA|ADVOCACIA|ADVOGADOS' +
    '|SERVEAL|SOCIEDADE|FUNDACAO|INSTITUTO|EMPRESA|CONDOMINIO|JUIZO|VARA (?:DO|DA|DE|CIVEL|FEDERAL))\\b' +
    '|(?:^|\\s)S\\s?\\/\\s?A(?:\\s|\\.|$)|(?:^|\\s)S\\.A\\.?(?:\\s|$)|(?:^|[\\s-])MEI?$',
);

const RE_ENTIDADE_DE_CLASSE = /\b(?:SINDICATO|ASSOCIACAO|COOPERATIVA|FEDERACAO|CONFEDERACAO)\b/;

/**
 * Por que esse nome não pode ser o credor do precatório — ou null se pode.
 *
 * `advogados` são nomes como vêm do DJEN; `peritos` são nomes (normalizados
 * ou não) de quem fez os cálculos — no TRT19 o mesmo calculista aparece como
 * polo A em uma dúzia de processos.
 */
export function motivoNaoCredor(
  nome: string,
  ctx: { advogados?: readonly string[]; peritos?: ReadonlySet<string> } = {},
): MotivoNaoCredor | null {
  const n = normalizarNome(nome);
  if (!n) return null;

  // Entidade de classe antes do ente: "SINDICATO DOS ENGENHEIROS NO ESTADO DE
  // ALAGOAS" tem "ESTADO DE ALAGOAS" no nome e é do lado de quem recebe.
  if (RE_ENTIDADE_DE_CLASSE.test(n)) return 'empresa, escritório ou sindicato';
  // classificarDevedor já cobre Estado, União, INSS, município e as estatais
  // (Caixa, BB) — tudo que não é 'privado' é o lado que deve, não o que recebe.
  if (classificarDevedor(nome).classe !== 'privado') return 'ente público';
  if (RE_PESSOA_JURIDICA.test(n)) return 'empresa, escritório ou sindicato';

  for (const adv of ctx.advogados ?? []) {
    const a = normalizarNome(adv);
    // Prefixo cobre o nome truncado no texto ("FULANO DE TAL" vs "FULANO DE TAL SOBRINHO").
    if (a === n || a.startsWith(`${n} `)) return 'advogado do processo';
  }

  if (ctx.peritos) {
    if (ctx.peritos.has(n)) return 'perito';
    for (const p of ctx.peritos) if (normalizarNome(p) === n) return 'perito';
  }
  return null;
}

/**
 * "perito contábil JOSE DA SILVA", "a perita MARIA ...", "perito credor:
 * FULANO - CRC/AL". O rótulo vem em qualquer caixa; o nome tem que vir em
 * maiúscula (é assim que o TRT19 escreve parte e auxiliar do juízo).
 */
const RE_ROTULO_PERITO =
  /\bperit[oa](?:\(a\))?s?((?:\s+(?:cont[áa]bil|judicial|do\s+ju[íi]zo|calculista|nomead[oa]|credor|oficial))*)\s*:?\s*/gi;
const RE_NOME_PERITO = new RegExp(`${PALAVRA}(?: ${PALAVRA})*`, 'y');

/** Nomes (normalizados) de quem o próprio texto chama de perito. */
export function peritosCitados(pubs: readonly Publicacao[]): Set<string> {
  const peritos = new Set<string>();
  for (const pub of pubs) {
    const texto = prepararTexto(pub.texto);
    for (const m of texto.matchAll(RE_ROTULO_PERITO)) {
      RE_NOME_PERITO.lastIndex = m.index + m[0].length;
      const nome = RE_NOME_PERITO.exec(texto);
      if (!nome) continue;
      const analisado = analisarNome(nome[0]);
      if (analisado) peritos.add(analisado.chave);
    }
  }
  return peritos;
}

// ---------------------------------------------------------------------------
// Credor
// ---------------------------------------------------------------------------

interface Captura {
  analisado: NomeAnalisado;
  tipo: 'cabecalho' | 'recurso';
}

function capturasDoTexto(texto: string): Captura[] {
  const capturas: Captura[] = [];
  const empurra = (bruto: string | undefined, tipo: Captura['tipo']) => {
    if (!bruto) return;
    const analisado = analisarNome(bruto);
    if (analisado) capturas.push({ analisado, tipo });
  };

  for (const m of texto.matchAll(RE_CAB_CREDOR)) empurra(m[1], 'cabecalho');
  for (const m of texto.matchAll(RE_CAB_RECURSO)) empurra(m[1], 'recurso');

  // Sem rótulo, o 1º nome é o polo ativo DA INSTÂNCIA: na vara é o credor, no
  // tribunal é quem recorre (o ente). Se o 1º for ente/empresa, o 2º é o
  // recorrido e vale como recurso — é o "  : CARHP E OUTROS (1)  : FULANO"
  // dos acórdãos.
  const semRotulo = RE_CAB_SEM_ROTULO.exec(texto);
  if (semRotulo) {
    empurra(semRotulo[1], 'cabecalho');
    const primeiro = analisarNome(semRotulo[1] ?? '');
    const motivo = primeiro ? motivoNaoCredor(primeiro.nome) : null;
    if (!primeiro || motivo === 'ente público' || motivo === 'empresa, escritório ou sindicato') {
      empurra(semRotulo[2], 'recurso');
    }
  }
  return capturas;
}

interface Candidato {
  /** Nome como o DJEN lista o destinatário (forma canônica do PJe), quando houver. */
  nomePolo: string | null;
  /** Primeira forma vista no texto, na publicação mais recente. */
  nomeTexto: string | null;
  pontos: number;
  /** Índice (em ordem de recência) da publicação mais recente onde apareceu. */
  maisRecente: number;
  temCabecalho: boolean;
  temRecurso: boolean;
  plurima: boolean;
  espolio: boolean;
}

/** Junta os nomes de advogado de todas as publicações (pra descartar como credor). */
function nomesDeAdvogados(pubs: readonly Publicacao[]): string[] {
  const nomes = new Set<string>();
  for (const pub of pubs) for (const a of pub.advogados ?? []) nomes.add(a.nome);
  return [...nomes];
}

/** Peritos do lote (opts) + os citados no próprio processo, tudo normalizado. */
function juntarPeritos(pubs: readonly Publicacao[], extra?: ReadonlySet<string>): Set<string> {
  const peritos = peritosCitados(pubs);
  for (const p of extra ?? []) peritos.add(normalizarNome(p));
  return peritos;
}

/**
 * Escolhe o credor por pontuação: cabeçalho PJe 10, cabeçalho de recurso 3,
 * destinatário do polo A +1 — cada um contado uma vez por publicação. Vence
 * a maior pontuação entre quem não foi descartado; empate vai pra quem
 * aparece na publicação mais recente.
 */
export function escolherCredor(
  pubs: readonly Publicacao[],
  opts: { peritos?: ReadonlySet<string> } = {},
): CredorConsolidado {
  const ordenadas = porRecencia(publicacoesValidas(pubs));
  const candidatos = new Map<string, Candidato>();

  const candidato = (chave: string, i: number): Candidato => {
    let c = candidatos.get(chave);
    if (!c) {
      c = {
        nomePolo: null,
        nomeTexto: null,
        pontos: 0,
        maisRecente: i,
        temCabecalho: false,
        temRecurso: false,
        plurima: false,
        espolio: false,
      };
      candidatos.set(chave, c);
    }
    return c;
  };

  ordenadas.forEach((pub, i) => {
    // Peso por publicação: o maior rótulo que o nome ganhou nela, mais o polo.
    // Sem isso uma publicação que repete o cabeçalho no corpo contaria em dobro.
    const pesoNaPub = new Map<string, number>();

    for (const { analisado, tipo } of capturasDoTexto(prepararTexto(pub.texto))) {
      const c = candidato(analisado.chave, i);
      c.nomeTexto ??= analisado.nome;
      c.espolio ||= analisado.espolio;
      if (tipo === 'cabecalho') {
        c.temCabecalho = true;
        c.plurima ||= analisado.plurima;
      } else {
        c.temRecurso = true;
      }
      const peso = tipo === 'cabecalho' ? PESO_CABECALHO : PESO_RECURSO;
      pesoNaPub.set(analisado.chave, Math.max(pesoNaPub.get(analisado.chave) ?? 0, peso));
    }

    const poloNaPub = new Set<string>();
    for (const d of pub.destinatarios ?? []) {
      if (d.polo !== 'A' || d.mascarado) continue;
      const analisado = analisarNome(d.nome);
      if (!analisado) continue;
      const c = candidato(analisado.chave, i);
      c.nomePolo ??= analisado.nome;
      c.espolio ||= analisado.espolio;
      poloNaPub.add(analisado.chave);
    }

    for (const chave of new Set([...pesoNaPub.keys(), ...poloNaPub])) {
      const c = candidatos.get(chave)!;
      c.pontos += (pesoNaPub.get(chave) ?? 0) + (poloNaPub.has(chave) ? PESO_POLO : 0);
      c.maisRecente = Math.min(c.maisRecente, i);
    }
  });

  const ctx = {
    advogados: nomesDeAdvogados(ordenadas),
    peritos: juntarPeritos(pubs, opts.peritos),
  };
  const validos = [...candidatos.values()]
    .filter((c) => motivoNaoCredor(c.nomePolo ?? c.nomeTexto ?? '', ctx) === null)
    .sort((a, b) => b.pontos - a.pontos || a.maisRecente - b.maisRecente);

  const exibir = (c: Candidato) => {
    const base = c.nomePolo ?? c.nomeTexto ?? '';
    return c.espolio ? `${base} (ESPÓLIO)` : base;
  };

  const vencedor = validos[0];
  if (!vencedor) return { nome: null, fonte: null, plurima: false, espolio: false, outros: [] };

  const fonte = vencedor.temCabecalho ? 'cabecalho' : vencedor.temRecurso ? 'recurso' : 'polo';
  return {
    nome: exibir(vencedor),
    fonte,
    plurima: vencedor.plurima,
    espolio: vencedor.espolio,
    outros: validos.slice(1).map(exibir),
  };
}

// ---------------------------------------------------------------------------
// Advogado
// ---------------------------------------------------------------------------

type Lado = 'credor' | 'devedor';

/** Ocorrência de uma parte (ou de um rótulo de lado) no texto normalizado. */
interface Marca {
  fim: number;
  inicio: number;
  lado: Lado;
}

/**
 * Entre a parte e o advogado não pode haver troca de seção: "RÉU: ESTADO DE
 * ALAGOAS  INTIMAÇÃO Fica o(a) beneficiário(a) FULANO" não faz do FULANO
 * advogado do Estado — o cabeçalho acabou e começou o corpo.
 */
const RE_QUEBRA_DE_SECAO =
  /\b(?:INTIMACAO|NOTIFICACAO|DESPACHO|DECISAO|SENTENCA|CERTIDAO|ACORDAO|EDITAL|INTIME|RELATORA?)\b/;

/** "Advogado(s) de: FULANO" — o único formato do corpus em que a parte vem DEPOIS. */
const RE_ADVOGADO_DE =
  /^\s*[,\-–]?\s*(?:OAB[^A-Z]{0,4}[A-Z]{0,2}[\s:/]*[\d.]+[A-Z]?\s*)?ADVOGAD[OA]\(?S?\)?\s+DE\s*:?\s*/;

const RE_ROTULO_LADO =
  /(?<![A-Z])(EXECUTAD[OA]S?|REUS?|RECLAMAD[OA]S?|EXEQUENTES?|AUTOR(?:A|ES|AS)?|RECLAMANTES?|REQUERENTES?)(?:\([A-Z]{1,2}\))*(?:\/[A-Z()]+)?\s*:/g;

/** Todas as ocorrências de `agulha` como palavra inteira em `texto` (ambos normalizados). */
function ocorrencias(texto: string, agulha: string): number[] {
  const achadas: number[] = [];
  if (!agulha) return achadas;
  let de = 0;
  for (;;) {
    const i = texto.indexOf(agulha, de);
    if (i < 0) return achadas;
    const antes = i === 0 ? ' ' : texto[i - 1]!;
    const depois = texto[i + agulha.length] ?? ' ';
    if (!/[A-Z0-9]/.test(antes) && !/[A-Z0-9]/.test(depois)) achadas.push(i);
    de = i + 1;
  }
}

/** Lado de uma parte pelo nome: ente/empresa devem; pessoa física e sindicato recebem. */
function ladoPeloNome(nome: string, peritos: ReadonlySet<string>): Lado | null {
  // Sindicato é substituto processual do trabalhador: o advogado dele é do credor.
  if (/\bSINDICATO\b/.test(normalizarNome(nome))) return 'credor';
  const motivo = motivoNaoCredor(nome, { peritos });
  if (motivo === 'perito') return null; // auxiliar do juízo, não tem lado
  return motivo === null ? 'credor' : 'devedor';
}

interface GrupoAdvogado {
  nomes: Set<string>;
  nome: string;
  oab: string;
  credor: number;
  devedor: number;
  /** Índice de recência da publicação mais recente onde ganhou voto. */
  ultimoVoto: number;
}

/**
 * Junta o mesmo advogado listado de formas diferentes. O DJEN troca o `id`
 * entre publicações e escreve a OAB com e sem hífen ("6191-B" e "6191B"),
 * então qualquer um dos três (id, OAB+UF, nome) une os registros.
 */
function agruparAdvogados(pubs: readonly Publicacao[]): GrupoAdvogado[] {
  const pai: number[] = [];
  const achar = (i: number): number => (pai[i] === i ? i : (pai[i] = achar(pai[i]!)));
  const registros: Array<{ nome: string; oab: string }> = [];
  const porChave = new Map<string, number>();

  for (const pub of pubs) {
    for (const a of pub.advogados ?? []) {
      const i = registros.length;
      registros.push({ nome: a.nome, oab: `${a.oab}/${a.uf}` });
      pai.push(i);
      const oabNorm = `${a.oab}`
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '')
        .replace(/^0+/, '');
      const chaves = [
        `id:${a.id}`,
        `oab:${oabNorm}/${`${a.uf}`.toUpperCase()}`,
        `nome:${normalizarNome(a.nome)}`,
      ];
      for (const chave of chaves) {
        const j = porChave.get(chave);
        if (j === undefined) porChave.set(chave, i);
        else pai[achar(i)] = achar(j);
      }
    }
  }

  const grupos = new Map<number, GrupoAdvogado>();
  registros.forEach((r, i) => {
    const raiz = achar(i);
    let g = grupos.get(raiz);
    if (!g) {
      // `pubs` vem em ordem de recência: o 1º registro do grupo é a grafia mais nova.
      g = {
        nomes: new Set(),
        nome: r.nome,
        oab: r.oab,
        credor: 0,
        devedor: 0,
        ultimoVoto: Infinity,
      };
      grupos.set(raiz, g);
    }
    g.nomes.add(normalizarNome(r.nome));
  });
  return [...grupos.values()];
}

/**
 * Escolhe o advogado do CREDOR pelo texto. Pra cada vez que o nome do
 * advogado aparece, olha ~300 caracteres pra trás e vê qual parte está mais
 * perto: ente/empresa/EXECUTADO/RÉU/RECLAMADO vota devedor; pessoa física ou
 * sindicato vota credor. Vence quem tem mais votos de credor, desde que tenha
 * mais votos de credor que de devedor.
 *
 * Quando o texto não cita advogado nenhum, devolve null de propósito — o
 * `advogados[0]` antigo era o procurador do Estado em ~61 processos, e um
 * telefone errado custa mais pro broker que um campo vazio.
 */
export function escolherAdvogado(
  pubs: readonly Publicacao[],
  credor?: string | null,
): AdvogadoConsolidado {
  return vencedorDoCredor(votarAdvogados(porRecencia(publicacoesValidas(pubs)), credor));
}

function vencedorDoCredor(grupos: readonly GrupoAdvogado[]): AdvogadoConsolidado {
  const vencedor = grupos
    .filter((g) => g.credor > 0 && g.credor > g.devedor)
    .sort(
      (a, b) =>
        b.credor - a.credor ||
        b.credor - b.devedor - (a.credor - a.devedor) ||
        a.ultimoVoto - b.ultimoVoto,
    )[0];
  return vencedor ? { nome: vencedor.nome, oab: vencedor.oab } : null;
}

/**
 * Advogados que o texto liga ao lado que DEVE (mais votos de devedor que de
 * credor). O recálculo usa pra só apagar ou trocar o advogado gravado quando
 * há evidência de que ele é do outro lado — sem evidência, mantém.
 */
function advogadosDoDevedor(
  grupos: readonly GrupoAdvogado[],
): Array<{ nome: string; oab: string }> {
  return grupos.filter((g) => g.devedor > g.credor).map((g) => ({ nome: g.nome, oab: g.oab }));
}

/** Conta, pra cada advogado do processo, os votos de credor e de devedor. */
function votarAdvogados(ordenadas: readonly Publicacao[], credor?: string | null): GrupoAdvogado[] {
  const grupos = agruparAdvogados(ordenadas);
  if (grupos.length === 0) return grupos;

  const nomesAdv = new Set(grupos.flatMap((g) => [...g.nomes]));
  const ehAdvogado = (n: string) => [...nomesAdv].some((a) => a === n || a.startsWith(`${n} `));
  const peritos = peritosCitados(ordenadas);
  const credorNorm = credor
    ? normalizarNome(credor.replace(/\s*\(ESP[ÓO]LIO(?: DE)?\)\s*/g, ' '))
    : null;

  ordenadas.forEach((pub, i) => {
    const bruto = prepararTexto(pub.texto);
    const texto = normalizarNome(bruto);
    if (!texto) return;

    // Partes desta publicação: destinatários + nomes de cabeçalho, com o lado.
    const partes = new Map<string, Lado>();
    const anota = (nome: string, lado: Lado | null) => {
      const analisado = analisarNome(nome);
      if (!analisado || lado === null || ehAdvogado(analisado.chave)) return;
      if (!partes.has(analisado.chave)) partes.set(analisado.chave, lado);
    };
    if (credorNorm) anota(credorNorm, 'credor');
    for (const m of bruto.matchAll(RE_CAB_DEVEDOR)) {
      const rotulo = normalizarNome(m[1] ?? '');
      const rotuloDevedor = /^(EXECUTAD|REU|RECLAMAD)/.test(rotulo);
      anota(m[2] ?? '', rotuloDevedor ? 'devedor' : ladoPeloNome(m[2] ?? '', peritos));
    }
    for (const { analisado } of capturasDoTexto(bruto)) {
      anota(analisado.nome, ladoPeloNome(analisado.nome, peritos));
    }
    for (const d of pub.destinatarios ?? []) {
      if (!d.mascarado) anota(d.nome, ladoPeloNome(d.nome, peritos));
    }

    const marcas: Marca[] = [];
    for (const [chave, lado] of partes) {
      for (const inicio of ocorrencias(texto, chave))
        marcas.push({ inicio, fim: inicio + chave.length, lado });
    }
    // Rótulo sozinho também marca lado: com credor mascarado ("EXEQUENTE:
    // E.A.D.O.  ADVOGADO: FULANO") o rótulo é a única pista.
    for (const m of texto.matchAll(RE_ROTULO_LADO)) {
      const lado: Lado = /^(EXECUTAD|REU|RECLAMAD)/.test(m[1]!) ? 'devedor' : 'credor';
      marcas.push({ inicio: m.index, fim: m.index + m[0].length, lado });
    }

    for (const g of grupos) {
      for (const nomeAdv of g.nomes) {
        for (const pos of ocorrencias(texto, nomeAdv)) {
          let lado: Lado | null = null;

          const depois = texto.slice(pos + nomeAdv.length);
          const advDe = RE_ADVOGADO_DE.exec(depois);
          if (advDe) {
            const alvo = pos + nomeAdv.length + advDe[0].length;
            lado = marcas.find((mc) => mc.inicio === alvo)?.lado ?? null;
          }

          if (lado === null) {
            let melhor: Marca | null = null;
            for (const mc of marcas) {
              if (mc.fim > pos || mc.fim < pos - JANELA_ADVOGADO) continue;
              if (!melhor || mc.fim > melhor.fim) melhor = mc;
            }
            if (melhor && !RE_QUEBRA_DE_SECAO.test(texto.slice(melhor.fim, pos)))
              lado = melhor.lado;
          }

          if (lado === null) continue;
          if (lado === 'credor') g.credor++;
          else g.devedor++;
          g.ultimoVoto = Math.min(g.ultimoVoto, i);
        }
      }
    }
  });

  return grupos;
}

// ---------------------------------------------------------------------------
// Red flags e consolidação
// ---------------------------------------------------------------------------

/**
 * Deduplica red flags por código e devolve só os códigos, na ordem em que
 * apareceram. Se o mesmo padrão bateu 5x em 3 publicações, entra uma vez.
 * O detalhe completo (trecho, contexto) fica em `djen_publicacoes.red_flags`.
 */
export function codigosDedup(flags: readonly RedFlag[]): string[] {
  const vistos = new Set<string>();
  const codigos: string[] = [];
  for (const f of flags) {
    if (vistos.has(f.codigo)) continue;
    vistos.add(f.codigo);
    codigos.push(f.codigo);
  }
  return codigos;
}

/**
 * O que o batch grava em `prospeccao_precatorios`. As red flags juntam TODAS
 * as publicações válidas, na ordem em que chegaram: uma cessão averbada 6
 * meses atrás continua contando hoje.
 *
 * `opts.peritos` é pra quem consolida vários processos de uma vez: o
 * calculista citado num processo é polo A em outros onde o texto não diz que
 * ele é perito.
 */
export function consolidarProcesso(
  pubs: readonly Publicacao[],
  opts: { peritos?: ReadonlySet<string> } = {},
): {
  credor: CredorConsolidado;
  advogado: AdvogadoConsolidado;
  advogadosDevedor: Array<{ nome: string; oab: string }>;
  redFlags: string[];
} {
  const validas = publicacoesValidas(pubs);
  const credor = escolherCredor(validas, opts);
  const grupos = votarAdvogados(porRecencia(validas), credor.nome);
  return {
    credor,
    advogado: vencedorDoCredor(grupos),
    advogadosDevedor: advogadosDoDevedor(grupos),
    redFlags: codigosDedup(validas.flatMap((p) => p.redFlags ?? [])),
  };
}
