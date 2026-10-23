/**
 * Varredura do DJEN por nome de pessoa, agrupada por processo e triada pelo
 * devedor.
 *
 * O problema que resolve (RGT-95): a API do DJEN aceita `nomeParte`, mas
 * devolve **publicações**, não processos — e para nome comum devolve centenas.
 * "Maria Antonia dos Santos" rendeu 66 publicações no TRT19, 138 no TJAL e 198
 * no TRF5. Jogar isso na tela do broker é inútil.
 *
 * O que este módulo faz: agrupa por CNJ, descobre quem está do outro lado,
 * classifica a esfera do devedor e ordena pelo que a RGT compra. No mesmo
 * levantamento, isso levaria 77 processos a 1.
 *
 * NÃO importar de client component — usa o rate limiter in-memory do cliente
 * DJEN, que só faz sentido no server.
 */

import { iterarPublicacoes } from './client';
import {
  classeDominante,
  devedoresProvaveis,
  normalizarNome,
  ordemDeRelevancia,
  type ClasseDevedor,
  type DevedorClassificado,
} from './devedor-publico';
import { DjenError, type Publicacao, type RedFlag } from './types';

/**
 * Tribunais varridos por padrão.
 *
 * Varrer um só não serve, e o caso da Waldiria prova: no TRT19 ela só tinha
 * reclamação trabalhista em fase de conhecimento, e o processo que interessa —
 * contra o Estado de Alagoas — estava no TJAL. Quem busca em um tribunal
 * conclui "não tem nada" e está errado.
 */
export const TRIBUNAIS_PADRAO = ['TRT19', 'TJAL', 'TRF5'] as const;

/**
 * Teto de páginas por tribunal. 100 itens por página, então 3 páginas = 300
 * publicações — acima do pior caso medido (198, no TRF5). O teto existe pra
 * uma busca por "Silva" não virar varredura do diário inteiro; quando bate,
 * avisamos em vez de truncar calado.
 */
const MAX_PAGINAS_POR_TRIBUNAL = 3;
const ITENS_POR_PAGINA = 100;

/** Red flags que dizem em que pé está o processo, não se ele tem problema. */
const SINAIS_DE_FASE: Record<string, string> = {
  X1: 'ofício requisitório / precatório',
  X4: 'RPV',
  '9': 'trânsito em julgado',
  '10': 'recurso pendente',
  '5': 'suspenso',
  '4': 'quitado ou arquivado',
  // Extinção citada sem falar em pagamento: no TRT19 quase sempre é o texto
  // padrão pós-expedição, mas pode ser prescrição — vale abrir e ler.
  '4e': 'extinção citada (ler)',
};

export interface ProcessoEncontrado {
  cnj: string;
  cnjMascarado: string;
  siglaTribunal: string;
  /** Órgão da publicação mais recente — dá a instância atual. */
  orgao: string;
  /** Como o nome da pessoa realmente aparece nos autos, que varia. */
  nosAutos: string[];
  devedores: DevedorClassificado[];
  classe: ClasseDevedor;
  /** A RGT compra precatório dessa esfera hoje? */
  comprado: boolean;
  publicacoes: number;
  primeiraPublicacao: string;
  ultimaPublicacao: string;
  /** Sinais de fase legíveis, derivados das red flags já detectadas. */
  fase: string[];
  redFlags: RedFlag[];
}

export interface ResultadoBusca {
  nome: string;
  tribunais: string[];
  /** Ordenado: o que a RGT compra primeiro, mais recente antes. */
  processos: ProcessoEncontrado[];
  totalPublicacoes: number;
  /** Quantos processos sobraram depois de tirar os de devedor privado. */
  comprados: number;
  /** Mensagens pro broker — nunca falhar em silêncio. */
  avisos: string[];
}

export interface OpcoesBusca {
  tribunais?: readonly string[];
  /** Pra teste: injeta um iterador no lugar do cliente real. */
  iterador?: typeof iterarPublicacoes;
}

interface Acumulado {
  cnj: string;
  cnjMascarado: string;
  siglaTribunal: string;
  orgao: string;
  nosAutos: Set<string>;
  devedores: Map<string, DevedorClassificado>;
  publicacoes: number;
  datas: string[];
  redFlags: Map<string, RedFlag>;
}

function acumular(acc: Map<string, Acumulado>, pub: Publicacao, nomeBuscado: string): void {
  const chave = `${pub.siglaTribunal}:${pub.processo.cnj}`;
  let a = acc.get(chave);
  if (!a) {
    a = {
      cnj: pub.processo.cnj,
      cnjMascarado: pub.processo.cnjMascarado,
      siglaTribunal: pub.siglaTribunal,
      orgao: pub.orgao.nome,
      nosAutos: new Set(),
      devedores: new Map(),
      publicacoes: 0,
      datas: [],
      redFlags: new Map(),
    };
    acc.set(chave, a);
  }

  a.publicacoes += 1;
  if (pub.dataDisponibilizacao) a.datas.push(pub.dataDisponibilizacao);

  // O órgão da publicação mais recente é o que vale: mostra a instância atual.
  const maisRecente =
    a.datas.length === 0 || pub.dataDisponibilizacao >= a.datas[a.datas.length - 1];
  if (maisRecente && pub.orgao.nome) a.orgao = pub.orgao.nome;

  const buscado = normalizarNome(nomeBuscado);
  for (const d of pub.destinatarios) {
    const n = normalizarNome(d.nome);
    if (n.startsWith(buscado) || buscado.startsWith(n)) a.nosAutos.add(d.nome);
  }

  for (const dev of devedoresProvaveis(pub.destinatarios, nomeBuscado)) {
    a.devedores.set(normalizarNome(dev.nome), dev);
  }

  for (const rf of pub.redFlags) {
    if (!a.redFlags.has(rf.codigo)) a.redFlags.set(rf.codigo, rf);
  }
}

function finalizar(a: Acumulado): ProcessoEncontrado {
  const devedores = [...a.devedores.values()];
  const classe = classeDominante(devedores);
  const datas = [...a.datas].sort();
  const fase = [...a.redFlags.keys()]
    .filter((c) => c in SINAIS_DE_FASE)
    .map((c) => SINAIS_DE_FASE[c]);

  return {
    cnj: a.cnj,
    cnjMascarado: a.cnjMascarado,
    siglaTribunal: a.siglaTribunal,
    orgao: a.orgao,
    nosAutos: [...a.nosAutos],
    devedores,
    classe,
    comprado: classe === 'federal' || classe === 'estadual',
    publicacoes: a.publicacoes,
    primeiraPublicacao: datas[0] ?? '',
    ultimaPublicacao: datas[datas.length - 1] ?? '',
    fase,
    redFlags: [...a.redFlags.values()],
  };
}

/**
 * Busca um nome nos tribunais indicados e devolve processos, não publicações.
 *
 * Nunca lança por falha de um tribunal: se o TJAL cair, o resultado do TRT19
 * ainda serve e o aviso aparece na tela. Busca parcial é melhor que erro.
 */
export async function buscarPorNome(
  nome: string,
  opcoes: OpcoesBusca = {},
): Promise<ResultadoBusca> {
  const nomeLimpo = nome.trim();
  const tribunais = [...(opcoes.tribunais ?? TRIBUNAIS_PADRAO)];
  const iterar = opcoes.iterador ?? iterarPublicacoes;
  const avisos: string[] = [];
  let tribunaisComFalha = 0;

  if (nomeLimpo.length < 3) {
    return {
      nome: nomeLimpo,
      tribunais,
      processos: [],
      totalPublicacoes: 0,
      comprados: 0,
      avisos: ['Digite ao menos 3 caracteres.'],
    };
  }

  const acc = new Map<string, Acumulado>();
  let total = 0;

  for (const tribunal of tribunais) {
    let lidas = 0;
    const teto = MAX_PAGINAS_POR_TRIBUNAL * ITENS_POR_PAGINA;
    try {
      for await (const pub of iterar({
        siglaTribunal: tribunal,
        nomeParte: nomeLimpo,
        itensPorPagina: ITENS_POR_PAGINA,
      })) {
        acumular(acc, pub, nomeLimpo);
        lidas += 1;
        total += 1;
        if (lidas >= teto) {
          avisos.push(
            `${tribunal}: parei em ${teto} publicações. O nome é comum demais — refine ou use o CPF por outra fonte.`,
          );
          break;
        }
      }
    } catch (erro) {
      const msg = erro instanceof DjenError ? erro.message : String(erro);
      tribunaisComFalha += 1;
      avisos.push(`${tribunal}: falhou (${msg}). O resultado abaixo está incompleto.`);
    }
  }

  // Entre os que a RGT compra, federal e estadual valem o mesmo: o que separa
  // é estar vivo. Ordenar por esfera punha um processo arquivado de 2009 (de
  // um homônimo, no TRF5) acima do TJAL com publicação de 2026 (RGT-95).
  const processos = [...acc.values()].map(finalizar).sort((x, y) => {
    if (x.comprado !== y.comprado) return x.comprado ? -1 : 1;
    if (!x.comprado) {
      const porClasse = ordemDeRelevancia(x.classe) - ordemDeRelevancia(y.classe);
      if (porClasse !== 0) return porClasse;
    }
    return y.ultimaPublicacao.localeCompare(x.ultimaPublicacao);
  });

  const comprados = processos.filter((p) => p.comprado).length;

  if (processos.length === 0 && tribunaisComFalha === tribunais.length) {
    // Nenhum tribunal respondeu: dizer "nenhum processo, tente outro nome"
    // seria mentir — a busca nem aconteceu.
    avisos.push(
      'Nenhum tribunal respondeu, então a busca não aconteceu. Tente de novo em alguns minutos.',
    );
  } else if (processos.length === 0) {
    // O casamento é literal: "Waldiria Maria S Aires" não acha nada, mas
    // "Waldiria" acha. Sem este aviso o broker conclui que a pessoa não tem
    // processo, quando na verdade errou uma letra.
    avisos.push(
      'Nenhum processo. O DJEN casa o nome literalmente — tente só o primeiro nome ou um sobrenome, sem abreviar.',
    );
  } else if (comprados === 0) {
    avisos.push(
      `Nenhum dos ${processos.length} processos tem devedor público. Precatório só existe contra Fazenda Pública, então nenhum vira operação.`,
    );
  }

  // Partes contrárias diferentes no mesmo nome = provável homônimo. O DJEN não
  // devolve CPF nem data de nascimento, então não dá pra desambiguar aqui — mas
  // apresentar como se fosse uma pessoa só seria mentira.
  const contrapartes = new Set(
    processos.flatMap((p) => p.devedores.map((d) => normalizarNome(d.nome))),
  );
  if (processos.length > 1 && contrapartes.size > 1) {
    avisos.push(
      `${processos.length} processos com ${contrapartes.size} partes contrárias distintas — provavelmente mais de uma pessoa com esse nome. Confira pela parte contrária.`,
    );
  }

  return { nome: nomeLimpo, tribunais, processos, totalPublicacoes: total, comprados, avisos };
}
