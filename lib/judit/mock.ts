/**
 * Respostas simuladas da Judit, pra exercitar o fluxo de enriquecimento sem
 * gastar crédito real — a API ainda não foi contratada.
 *
 * Duas decisões de projeto valem explicação:
 *
 * 1. **Determinístico.** O mesmo CNJ devolve sempre o mesmo resultado, derivado
 *    de um hash do número. Sem isso, cada clique em "Enriquecer" mudaria a fila
 *    inteira e não daria pra reproduzir nada. Também dá variedade realista de
 *    graça: numa carteira de 128 processos aparecem penhoras, cessões e
 *    processos limpos na proporção que a distribuição abaixo define.
 *
 * 2. **Marcado como falso.** Todo payload carrega `_mock: true` e o nome do
 *    credor vem prefixado com "[SIMULADO]". Isso é proposital e não deve ser
 *    "melhorado": a tela de prospecção é onde se decide comprar um precatório,
 *    e dado inventado sem aviso ali vale dinheiro errado.
 */

import type { ProcessoJudit } from './types';

/** Hash estável (FNV-1a) — precisa ser determinístico entre execuções. */
function hash(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Escolhe determinístico dentro de uma lista. */
function escolher<T>(lista: T[], semente: number): T {
  return lista[semente % lista.length]!;
}

const NOMES = [
  'Maria José da Silva',
  'Antônio Carlos Ferreira',
  'Francisca Souza Lima',
  'José Raimundo dos Santos',
  'Ana Lúcia Barbosa',
  'João Batista Oliveira',
  'Terezinha de Jesus Melo',
  'Severino Ramos da Costa',
  'Luiza Helena Cavalcanti',
  'Manoel Gomes de Araújo',
  'Rita de Cássia Nunes',
  'Sebastião Alves Pereira',
  'Josefa Maria Andrade',
  'Paulo Roberto Tenório',
  'Vera Lúcia Monteiro',
];

const ADVOGADOS = [
  { nome: 'Dr. Ricardo Malta', oab: 'AL 4.512' },
  { nome: 'Dra. Patrícia Vasconcelos', oab: 'AL 6.887' },
  { nome: 'Dr. Fernando Acioli', oab: 'AL 3.204' },
  { nome: 'Dra. Cristiane Wanderley', oab: 'PE 9.110' },
  { nome: 'Dr. Eduardo Sampaio', oab: 'AL 7.733' },
];

const VARAS = [
  '1ª Vara do Trabalho de Maceió',
  '4ª Vara do Trabalho de Maceió',
  '8ª Vara do Trabalho de Maceió',
  '11ª Vara do Trabalho de Maceió',
];

/**
 * Cenários e frequência aproximada. Somam 100.
 * A distribuição imita uma carteira real: a maioria dos processos está limpa,
 * e os problemas aparecem numa minoria — se fosse uniforme, a fila ficaria
 * cheia de red flag e ninguém confiaria no filtro.
 */
type Cenario =
  | 'saudavel'
  | 'com_penhora'
  | 'nao_transitou'
  | 'ja_cedido'
  | 'sem_advogado'
  | 'parado'
  | 'nao_encontrado'
  | 'erro';

const DISTRIBUICAO: [Cenario, number][] = [
  ['saudavel', 55],
  ['com_penhora', 13],
  ['nao_transitou', 10],
  ['ja_cedido', 6],
  ['sem_advogado', 5],
  ['parado', 6],
  ['nao_encontrado', 3],
  ['erro', 2],
];

export function cenarioDoCnj(cnj: string): Cenario {
  const ponto = hash(cnj) % 100;
  let acumulado = 0;
  for (const [cenario, peso] of DISTRIBUICAO) {
    acumulado += peso;
    if (ponto < acumulado) return cenario;
  }
  return 'saudavel';
}

function mesesAtras(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString();
}

/** Erro simulado carrega o mesmo formato que o client trata de verdade. */
export class JuditMockNotFound extends Error {}
export class JuditMockErro extends Error {}

export function processoSimulado(cnj: string): ProcessoJudit {
  const semente = hash(cnj);
  const cenario = cenarioDoCnj(cnj);
  const advogado = escolher(ADVOGADOS, semente >> 3);

  const base: ProcessoJudit = {
    numero_cnj: cnj,
    tribunal: 'TRT19',
    vara: escolher(VARAS, semente >> 5),
    classe: 'Cumprimento de Sentença',
    assunto: 'Verbas Rescisórias',
    transitou_em_julgado: true,
    data_autuacao: mesesAtras(24 + (semente % 60)),
    data_ultimo_movimento: mesesAtras(semente % 4),
    partes: [
      {
        tipo: 'autor',
        // Prefixo deliberado: ninguém deve confundir isto com credor real.
        nome: `[SIMULADO] ${escolher(NOMES, semente)}`,
        cpf_cnpj: String(10000000000 + (semente % 89999999999)),
        advogados: [advogado],
      },
      { tipo: 'reu', nome: 'Estado de Alagoas' },
    ],
    _judit: { fonte: 'mock', atualizado_em: new Date().toISOString() },
  };

  switch (cenario) {
    case 'com_penhora':
      return {
        ...base,
        penhoras: [
          {
            valor: 5000 + (semente % 45000),
            data: mesesAtras(3 + (semente % 12)),
            descricao: 'Penhora no rosto dos autos — execução fiscal',
          },
        ],
      };
    case 'nao_transitou':
      return { ...base, transitou_em_julgado: false };
    case 'ja_cedido':
      return {
        ...base,
        cessoes: [
          {
            cessionario_nome: '[SIMULADO] Fundo de Investimento Precatórios II',
            data: mesesAtras(6 + (semente % 18)),
          },
        ],
      };
    case 'sem_advogado':
      return {
        ...base,
        partes: [{ ...base.partes![0]!, advogados: [] }, base.partes![1]!],
      };
    case 'parado':
      return { ...base, data_ultimo_movimento: mesesAtras(8 + (semente % 20)) };
    default:
      return base;
  }
}

/** true quando o modo simulado está ligado explicitamente. */
export function modoMockLigado(): boolean {
  return process.env.JUDIT_MODO === 'mock';
}
