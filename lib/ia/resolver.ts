/**
 * Traduz a extração bruta da IA em campos que o formulário aceita.
 *
 * Isto aqui é a camada que impede a IA de inventar estado inválido. Nada do
 * que ela devolve entra no formulário sem passar por uma validação
 * determinística escrita em TypeScript:
 *
 * - enum só passa se estiver na constante do `schemas.ts`;
 * - tribunal sai do CNJ (segmento + código do tribunal), não da leitura;
 * - ente devedor tem que casar com uma linha real de `entes_devedores`;
 * - valor, data, CPF e LOA passam por parser próprio.
 *
 * O que não passa vira aviso pro usuário, nunca preenchimento silencioso.
 */

import { maskCNJ, maskCPF } from '@/lib/masks';
import { TRIBUNAIS_POR_ESFERA, type Esfera } from '@/lib/tribunais';
import { titleCase } from '@/lib/formatters';
import { ESPECIES, NATUREZAS, TIPOS_ATIVO } from '@/app/(dashboard)/operacoes/nova/schemas';
import { decodificarCnj, digitosCnj } from './cnj';
import {
  CAMPO_AUSENTE,
  indexarCampos,
  type CampoExtraido,
  type Confianca,
  type ExtracaoOficio,
} from './schema';

export type EnteOpcao = { id: string; nome: string; esfera: Esfera };

export type CampoRevisao = {
  /** Identificador estável pro React e pro estado de "aplicado". */
  id: string;
  passo: 1 | 2;
  label: string;
  /** Já formatado pra leitura humana (R$, dd/mm/aaaa, label do select). */
  valorExibido: string;
  confianca: Confianca;
  /** Citação literal do PDF. É a prova que o revisor confere. */
  trecho: string | null;
  /** Campo de dinheiro exige conferência explícita — nunca aplicar em massa. */
  monetario: boolean;
  /** Patch aplicado no estado do formulário quando o usuário aceita. */
  patch: Record<string, string | boolean>;
};

export type RevisaoOficio = {
  documentoReconhecido: boolean;
  campos: CampoRevisao[];
  /** Coisas que a IA achou mas o app não consegue aplicar sozinho. */
  avisos: string[];
};

// ---------------------------------------------------------------- parsers

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "R$ 125.430,55" → "125430.55". Rejeita qualquer coisa que não vire número. */
export function parseValor(v: string | null): string | null {
  if (!v) return null;
  const limpo = v.replace(/[^\d.,-]/g, '').trim();
  if (!limpo) return null;

  // Decide qual é o separador decimal pelo que aparece por último. Cobre tanto
  // "125.430,55" (pt-BR) quanto "125430.55" (o formato que pedimos no prompt).
  const ultimaVirgula = limpo.lastIndexOf(',');
  const ultimoPonto = limpo.lastIndexOf('.');
  let normalizado: string;
  if (ultimaVirgula > ultimoPonto) {
    normalizado = limpo.replace(/\./g, '').replace(',', '.');
  } else if (ultimoPonto > -1) {
    normalizado = limpo.replace(/,/g, '');
  } else {
    normalizado = limpo;
  }

  const n = Number(normalizado);
  if (!Number.isFinite(n) || n < 0) return null;
  return String(n);
}

/** Aceita yyyy-mm-dd e dd/mm/yyyy. Devolve sempre yyyy-mm-dd. */
export function parseData(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);

  let ano: string, mes: string, dia: string;
  if (iso) [, ano, mes, dia] = iso;
  else if (br) [, dia, mes, ano] = br;
  else return null;

  const m = Number(mes);
  const d = Number(dia);
  const a = Number(ano);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Precatório de antes de 1988 não existe; data futura é erro de leitura.
  if (a < 1988 || a > new Date().getFullYear() + 1) return null;

  return `${ano}-${mes}-${dia}`;
}

export function parseLoa(v: string | null): string | null {
  if (!v) return null;
  const m = /\b(20\d{2})\b/.exec(v);
  if (!m) return null;
  const ano = Number(m[1]);
  return ano >= 2020 && ano <= 2050 ? m[1] : null;
}

export function parsePercentual(v: string | null): string | null {
  const n = parseValor(v);
  if (n === null) return null;
  return Number(n) > 100 ? null : n;
}

function parseInteiro(v: string | null): string | null {
  if (!v) return null;
  const m = /\d+/.exec(v);
  if (!m) return null;
  const n = Number(m[0]);
  // RRA acima de 40 anos de retroativo não existe na prática — é erro de leitura.
  return Number.isInteger(n) && n >= 0 && n <= 480 ? String(n) : null;
}

/** Só aceita valor que exista na constante do formulário. */
function parseOpcao(
  v: string | null,
  opcoes: readonly { value: string; label: string }[],
): { value: string; label: string } | null {
  if (!v) return null;
  const alvo = semAcento(v).replace(/[\s-]+/g, '_');
  return opcoes.find((o) => o.value === alvo || semAcento(o.label) === semAcento(v)) ?? null;
}

// ------------------------------------------------------------- resolvers

/**
 * Casa a sigla do tribunal com a lista real do `<select>`.
 *
 * A lista é filtrada por esfera na tela, então quando a esfera é conhecida a
 * busca é restrita a ela — devolver um label que o select não tem seria pior
 * que não devolver nada.
 */
export function resolverTribunal(sigla: string | null, esfera: Esfera | null): string | null {
  if (!sigla) return null;
  const alvo = semAcento(sigla).replace(/[\s-]/g, '');
  const esferas: Esfera[] = esfera ? [esfera] : ['federal', 'estadual', 'municipal'];

  for (const e of esferas) {
    const achado = TRIBUNAIS_POR_ESFERA[e].find((t) => {
      const siglaLista = semAcento(t.split(' - ')[0] ?? '').replace(/[\s-]/g, '');
      return siglaLista === alvo;
    });
    if (achado) return achado;
  }
  return null;
}

const PREFIXOS_ENTE = [
  'municipio de',
  'municipio do',
  'prefeitura municipal de',
  'prefeitura de',
  'estado de',
  'estado do',
  'estado da',
  'fazenda publica do',
  'fazenda publica de',
  'fazenda publica estadual do',
  'governo do',
  'governo de',
];

function normalizarEnte(nome: string): string {
  let n = semAcento(nome).replace(/[.,/]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const p of PREFIXOS_ENTE) {
    if (n.startsWith(`${p} `)) {
      n = n.slice(p.length + 1);
      break;
    }
  }
  return n.trim();
}

/**
 * Casa o nome lido no documento com uma linha de `entes_devedores`.
 *
 * Só aceita casamento **inequívoco**: se o nome bate com dois entes, devolve
 * null. Escolher o errado aqui coloca a operação no ente devedor errado — o
 * campo que define índice de correção e ordem de pagamento.
 */
export function resolverEnte(nome: string | null, entes: readonly EnteOpcao[]): EnteOpcao | null {
  if (!nome) return null;
  const alvo = normalizarEnte(nome);
  if (!alvo) return null;

  const exatos = entes.filter((e) => normalizarEnte(e.nome) === alvo);
  if (exatos.length === 1) return exatos[0];
  if (exatos.length > 1) return null;

  const contidos = entes.filter((e) => {
    const n = normalizarEnte(e.nome);
    return n.includes(alvo) || alvo.includes(n);
  });
  return contidos.length === 1 ? contidos[0] : null;
}

// ---------------------------------------------------------------- montagem

const fmtBRL = (v: string) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtData = (iso: string) => {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
};

type Entrada = {
  id: string;
  passo: 1 | 2;
  label: string;
  campo: CampoExtraido;
  /** Converte o texto cru da IA no valor final. null descarta o campo. */
  parse: (v: string | null) => string | null;
  /** Como mostrar pro humano. Default: o próprio valor. */
  exibir?: (v: string) => string;
  /** Patch aplicado no formulário. Default: `{ [id]: valor }`. */
  patch?: (v: string) => Record<string, string | boolean>;
  monetario?: boolean;
};

/**
 * Converte a extração em lista de campos revisáveis.
 *
 * Campo que não sobrevive ao parse simplesmente não aparece — é melhor o
 * usuário digitar do que revisar um palpite.
 */
export function montarRevisao(
  extracao: ExtracaoOficio,
  entes: readonly EnteOpcao[],
): RevisaoOficio {
  const avisos: string[] = [];
  if (extracao.observacao) avisos.push(extracao.observacao);

  const lidos = indexarCampos(extracao);
  const ler = (nome: string): CampoExtraido => lidos.get(nome) ?? CAMPO_AUSENTE;

  const campoEnte = ler('ente_devedor');
  const campoTribunal = ler('tribunal_sigla');
  const campoProcesso = ler('numero_processo');

  const ente = resolverEnte(campoEnte.valor, entes);
  const esfera: Esfera | null = ente?.esfera ?? null;

  // O CNJ manda no tribunal: o segmento e o código do tribunal estão codificados
  // nos próprios dígitos. A sigla lida pela IA só entra quando não há CNJ.
  const cnj = decodificarCnj(campoProcesso.valor);
  const siglaTribunal = cnj?.siglaTribunal ?? campoTribunal.valor;
  const tribunal = resolverTribunal(siglaTribunal, esfera);

  if (siglaTribunal && !tribunal) {
    avisos.push(
      esfera
        ? `Tribunal identificado como ${siglaTribunal}, mas ele não aparece na lista da esfera ${esfera}. Selecione o tribunal manualmente.`
        : `Tribunal identificado como ${siglaTribunal}, mas não foi possível casar com a lista do formulário. Selecione manualmente.`,
    );
  }
  if (campoEnte.valor && !ente) {
    avisos.push(
      `Ente devedor lido como "${campoEnte.valor}" não foi encontrado no cadastro. Selecione manualmente — ou cadastre o ente antes.`,
    );
  }

  const entradas: Entrada[] = [
    {
      id: 'cedente_nome',
      passo: 1,
      label: 'Nome do cedente',
      campo: ler('cedente_nome'),
      parse: (v) => (v && v.trim().length >= 3 ? titleCase(v) : null),
    },
    {
      id: 'cedente_cpf',
      passo: 1,
      label: 'CPF do cedente',
      campo: ler('cedente_cpf'),
      parse: (v) => {
        const d = (v ?? '').replace(/\D/g, '');
        return d.length === 11 ? maskCPF(d) : null;
      },
    },
    {
      id: 'numero_processo',
      passo: 1,
      label: 'Número do processo',
      campo: ler('numero_processo'),
      parse: (v) => {
        const d = digitosCnj(v);
        return d ? maskCNJ(d) : null;
      },
    },
    {
      id: 'tipo',
      passo: 1,
      label: 'Tipo de ativo',
      campo: ler('tipo'),
      parse: (v) => parseOpcao(v, TIPOS_ATIVO)?.value ?? null,
      exibir: (v) => TIPOS_ATIVO.find((t) => t.value === v)?.label ?? v,
    },
    {
      id: 'natureza',
      passo: 1,
      label: 'Natureza',
      campo: ler('natureza'),
      parse: (v) => parseOpcao(v, NATUREZAS)?.value ?? null,
      exibir: (v) => NATUREZAS.find((t) => t.value === v)?.label ?? v,
    },
    {
      id: 'especie',
      passo: 1,
      label: 'Espécie',
      campo: ler('especie'),
      parse: (v) => parseOpcao(v, ESPECIES)?.value ?? null,
      exibir: (v) => ESPECIES.find((t) => t.value === v)?.label ?? v,
    },
    {
      id: 'data_base',
      passo: 1,
      label: 'Data-base',
      campo: ler('data_base'),
      parse: parseData,
      exibir: fmtData,
    },
    {
      id: 'data_autuacao',
      passo: 1,
      label: 'Data de autuação',
      campo: ler('data_autuacao'),
      parse: parseData,
      exibir: fmtData,
    },
    {
      id: 'loa',
      passo: 1,
      label: 'LOA',
      campo: ler('loa'),
      parse: parseLoa,
    },
    {
      id: 'valor_principal',
      passo: 2,
      label: 'Valor principal',
      campo: ler('valor_principal'),
      parse: parseValor,
      exibir: fmtBRL,
      monetario: true,
    },
    {
      id: 'valor_juros',
      passo: 2,
      label: 'Juros',
      campo: ler('valor_juros'),
      parse: parseValor,
      exibir: fmtBRL,
      monetario: true,
    },
    {
      id: 'valor_selic',
      passo: 2,
      label: 'Selic',
      campo: ler('valor_selic'),
      parse: parseValor,
      exibir: fmtBRL,
      monetario: true,
    },
    {
      id: 'retencao_honorarios_pct',
      passo: 2,
      label: 'Honorários contratuais',
      campo: ler('retencao_honorarios_pct'),
      parse: parsePercentual,
      exibir: (v) => `${v}%`,
      monetario: true,
    },
    {
      id: 'pss_pct',
      passo: 2,
      label: 'PSS',
      campo: ler('pss_pct'),
      parse: parsePercentual,
      exibir: (v) => `${v}%`,
      // O percentual só faz sentido com o toggle ligado — os dois andam juntos.
      patch: (v) => ({ pss_ativo: true, pss_pct: v }),
      monetario: true,
    },
    {
      id: 'rra_meses',
      passo: 2,
      label: 'RRA',
      campo: ler('rra_meses'),
      parse: parseInteiro,
      exibir: (v) => `${v} ${v === '1' ? 'mês' : 'meses'}`,
      patch: (v) => ({ rra_ativo: true, rra_meses: v }),
      monetario: true,
    },
  ];

  const campos: CampoRevisao[] = [];

  for (const e of entradas) {
    const valor = e.parse(e.campo.valor);
    if (valor === null) continue;
    campos.push({
      id: e.id,
      passo: e.passo,
      label: e.label,
      valorExibido: e.exibir ? e.exibir(valor) : valor,
      confianca: e.campo.confianca,
      trecho: e.campo.trecho,
      monetario: Boolean(e.monetario),
      patch: e.patch ? e.patch(valor) : { [e.id]: valor },
    });
  }

  // Ente e tribunal não saem de `entradas` porque o valor final é um id/label
  // resolvido contra o banco, não o texto que a IA leu.
  if (ente) {
    campos.push({
      id: 'ente_devedor_id',
      passo: 1,
      label: 'Ente devedor',
      valorExibido: ente.nome,
      confianca: campoEnte.confianca,
      trecho: campoEnte.trecho,
      monetario: false,
      // A esfera vem da linha do banco, não da leitura — e precisa entrar junto
      // porque o select de tribunal e o de ente são filtrados por ela.
      patch: { esfera: ente.esfera, ente_devedor_id: ente.id },
    });
  }

  if (tribunal) {
    campos.push({
      id: 'tribunal',
      passo: 1,
      label: 'Tribunal',
      valorExibido: tribunal.split(' - ')[0] ?? tribunal,
      // Derivado do CNJ é fato, não leitura: confiança alta por construção.
      confianca: cnj?.siglaTribunal ? 'alta' : campoTribunal.confianca,
      trecho: cnj?.siglaTribunal
        ? `Derivado dos dígitos do CNJ (${maskCNJ(cnj.digitos)})`
        : campoTribunal.trecho,
      monetario: false,
      patch: { tribunal },
    });
  }

  // Ordem importa de verdade: trocar a esfera limpa tribunal e ente_devedor no
  // formulário. Com o ente antes do tribunal, aplicar um por um de cima pra
  // baixo dá o mesmo resultado que "aplicar tudo".
  campos.sort((a, b) => ORDEM.indexOf(a.id) - ORDEM.indexOf(b.id));

  return { documentoReconhecido: extracao.documento_reconhecido, campos, avisos };
}

const ORDEM = [
  'cedente_nome',
  'cedente_cpf',
  'numero_processo',
  'tipo',
  'natureza',
  'especie',
  'ente_devedor_id',
  'tribunal',
  'data_base',
  'data_autuacao',
  'loa',
  'valor_principal',
  'valor_juros',
  'valor_selic',
  'retencao_honorarios_pct',
  'pss_pct',
  'rra_meses',
];
