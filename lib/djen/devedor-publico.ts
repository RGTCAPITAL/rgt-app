/**
 * Classifica o polo passivo de um processo pela esfera do devedor.
 *
 * Por que isso existe: busca por nome no DJEN devolve ruído inutilizável — um
 * nome comum como "Maria Antonia dos Santos" rendeu 77 processos entre TRT19,
 * TJAL e TRF5 (RGT-95). O que separa prospect de ruído não é o nome, é **quem
 * deve**: precatório só existe contra Fazenda Pública. Dos 9 processos dela no
 * TRT19, todos eram contra empresa ou pessoa física — nenhum podia virar
 * operação, qualquer que fosse a Maria Antonia certa.
 *
 * Por que é heurística e não consulta a `entes_devedores`: aquela tabela tem 21
 * linhas (15 federais, 6 estaduais, **zero municipais**). Ela é um master de
 * cadastro, não um dicionário de reconhecimento. Usar como fonte primária daria
 * falso negativo em quase todo ente real. A tabela continua útil pra enriquecer
 * depois que o broker aceita o prospect — aqui o trabalho é triagem.
 *
 * A classificação segue o enum `esfera_ativo` do banco, de propósito: o que sai
 * daqui alimenta `prospeccao_precatorios` e depois `operacoes`.
 */

/**
 * `estatal` é separada de propósito. Sociedade de economia mista e empresa
 * pública **não pagam por precatório** na regra geral (art. 173 §1º CF) — são
 * executadas como empresa privada. A exceção clássica é a ECT/Correios, que o
 * STF reconheceu como fazenda pública pra fins de precatório (RE 220.906). Sem
 * essa separação, um processo contra o Banco do Brasil viraria prospect.
 */
export type ClasseDevedor = 'federal' | 'estadual' | 'municipal' | 'estatal' | 'privado';

export interface DevedorClassificado {
  /** O nome como veio do DJEN, sem normalizar. */
  nome: string;
  classe: ClasseDevedor;
  /**
   * A RGT compra precatório dessa esfera **hoje**? Federal e estadual sim;
   * municipal está bloqueada (pouco volume, paga mal — e há trigger no banco
   * barrando cadastro). Ver as regras de negócio no OS.
   */
  comprado: boolean;
  /** O padrão que decidiu, pro broker conferir em vez de confiar cego. */
  motivo: string;
}

interface Regra {
  classe: ClasseDevedor;
  motivo: string;
  re: RegExp;
}

/**
 * Ordem importa: a primeira regra que casar vence. As mais específicas vêm
 * antes — "Defensoria Pública do Estado" tem que cair em estadual antes de
 * qualquer regra genérica de "defensoria".
 */
const REGRAS: Regra[] = [
  // --- Marcadores municipais inequívocos, antes de tudo ------------------
  // Vêm primeiro porque nenhum ente federal ou estadual tem "Município de" ou
  // "Prefeitura" no nome, e sem isso "Município de União" (que existe, no
  // Piauí) cairia na regra da União e viraria federal.
  { classe: 'municipal', motivo: 'Município', re: /\bMUNIC[ÍI]PIO D[OE]\s/ },
  { classe: 'municipal', motivo: 'prefeitura', re: /\bPREFEITURA\b/ },
  { classe: 'municipal', motivo: 'câmara municipal', re: /C[ÂA]MARA MUNICIPAL/ },
  { classe: 'municipal', motivo: 'fazenda municipal', re: /FAZENDA (P[ÚU]BLICA )?MUNICIPAL/ },

  // --- Federal -----------------------------------------------------------
  // "UNIÃO FEDERAL (AGU)" é como o TRT19 escreve. Exige limite de palavra pra
  // não casar com "UNIÃO DOS PALMARES", que é município de Alagoas e apareceu
  // no levantamento da RGT-95.
  { classe: 'federal', motivo: 'União', re: /\bUNI[ÃA]O\b(?!\s+D[OE]S?\s)/ },
  { classe: 'federal', motivo: 'AGU', re: /ADVOCACIA[-\s]GERAL DA UNI[ÃA]O|\bAGU\b/ },
  { classe: 'federal', motivo: 'Fazenda Nacional', re: /FAZENDA NACIONAL/ },
  { classe: 'federal', motivo: 'INSS', re: /\bINSS\b|INSTITUTO NACIONAL DO SEGURO SOCIAL/ },
  {
    classe: 'federal',
    motivo: 'autarquia ou fundação federal',
    re: /UNIVERSIDADE FEDERAL|INSTITUTO FEDERAL|\bIBAMA\b|\bINCRA\b|\bDNIT\b|\bDNOCS\b|\bFUNAI\b|\bFUNASA\b|\bANVISA\b|\bANEEL\b|\bANATEL\b|\bANS\b|\bANP\b|\bANTT\b|\bCADE\b|\bCVM\b/,
  },
  {
    classe: 'federal',
    motivo: 'conselho de fiscalização profissional (autarquia federal)',
    re: /CONSELHO (REGIONAL|FEDERAL) DE/,
  },

  // --- Estadual ----------------------------------------------------------
  // "ESTADO DE ALAGOAS" / "ESTADO DO RIO". Casa só com a preposição pra não
  // pegar "ESTADO DE CONSERVAÇÃO" num texto qualquer.
  { classe: 'estadual', motivo: 'Estado', re: /\bESTADO D[OE]\s+[A-ZÀ-Ú]/ },
  { classe: 'estadual', motivo: 'governo estadual', re: /GOVERNO D[OE] ESTADO/ },
  { classe: 'estadual', motivo: 'fazenda estadual', re: /FAZENDA (P[ÚU]BLICA )?ESTADUAL/ },
  {
    classe: 'estadual',
    motivo: 'órgão ou autarquia estadual',
    re: /DEFENSORIA P[ÚU]BLICA DO ESTADO|PROCURADORIA[-\s]GERAL DO ESTADO|ASSEMBLEIA LEGISLATIVA|POL[ÍI]CIA (MILITAR|CIVIL)|CORPO DE BOMBEIROS|UNIVERSIDADE ESTADUAL|\bDETRAN\b|\bDER[- ]?[A-Z]{2}\b/,
  },

  // --- Estatal (não gera precatório, salvo ECT) --------------------------
  {
    classe: 'federal',
    motivo: 'ECT — estatal que o STF equiparou a fazenda pública (RE 220.906)',
    re: /EMPRESA BRASILEIRA DE CORREIOS|\bECT\b|\bCORREIOS\b/,
  },
  {
    classe: 'estatal',
    motivo: 'estatal — executada como empresa privada, não gera precatório',
    re: /BANCO DO BRASIL|CAIXA ECON[ÔO]MICA|PETR[ÓO]LEO BRASILEIRO|\bPETROBRAS\b|ELETROBR[ÁA]S|\bINFRAERO\b|\bEMBRAPA\b|\bSERPRO\b|\bDATAPREV\b|COMPANHIA DE SANEAMENTO|\bCASAL\b/,
  },
];

/** Sufixos que marcam pessoa jurídica de direito privado com alta confiança. */
const RE_PJ_PRIVADA =
  /\b(LTDA|S\/A|S\.A\.?|SA|ME|EPP|EIRELI|MEI|CIA|COMPANHIA|ASSOCIA[ÇC][ÃA]O|SINDICATO|COOPERATIVA|CONDOM[ÍI]NIO)\b\.?$|\b(LTDA|EIRELI|EPP)\b/;

/**
 * Tira acento e normaliza espaços pra casar regex sem depender de como o
 * tribunal digitou. Os autos divergem entre si: o mesmo processo da Waldiria
 * traz "SIRQUEIRA" em primeira instância e "SIQUEIRA" na segunda.
 */
export function normalizarNome(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Esferas que a RGT compra hoje. Municipal está bloqueada no banco. */
const COMPRADAS: ReadonlySet<ClasseDevedor> = new Set<ClasseDevedor>(['federal', 'estadual']);

/**
 * Classifica um nome de parte. Função pura — a decisão sai só do texto, sem
 * consultar banco, pra ser testável e rodar em lote sem round-trip.
 */
export function classificarDevedor(nome: string): DevedorClassificado {
  const alvo = normalizarNome(nome);

  // Regex sem acento: normalizamos o nome, então normalizamos o padrão também.
  for (const regra of REGRAS) {
    const semAcento = new RegExp(
      regra.re.source
        .normalize('NFD')
        .replace(/\[\\u0300-\\u036f\]/g, '')
        .replace(/[̀-ͯ]/g, ''),
      regra.re.flags,
    );
    if (semAcento.test(alvo)) {
      return {
        nome,
        classe: regra.classe,
        comprado: COMPRADAS.has(regra.classe),
        motivo: regra.motivo,
      };
    }
  }

  return {
    nome,
    classe: 'privado',
    comprado: false,
    motivo: RE_PJ_PRIVADA.test(alvo) ? 'empresa privada' : 'pessoa física ou parte não reconhecida',
  };
}

/**
 * Dado os destinatários de uma publicação e o nome que foi pesquisado, devolve
 * os prováveis devedores — isto é, as partes que **não** são a pessoa buscada.
 *
 * Por que não usar só `polo === 'P'`: o DJEN lista intimados, não uma relação
 * formal de partes, e em boa parte das publicações de primeira instância só o
 * advogado da parte ativa é intimado. No levantamento da RGT-95 o "ESTADO DE
 * ALAGOAS" só apareceu quando o processo subiu pra segunda instância. Então
 * usamos o polo quando ele existe e vem confiável, e caímos na exclusão por
 * nome quando não vem.
 */
export function devedoresProvaveis(
  destinatarios: ReadonlyArray<{ nome: string; polo: 'A' | 'P' | 'T' }>,
  nomeBuscado: string,
): DevedorClassificado[] {
  const buscado = normalizarNome(nomeBuscado);

  const candidatos = destinatarios.filter((d) => {
    const n = normalizarNome(d.nome);
    // Fora quem é a própria pessoa buscada (casamento por prefixo cobre
    // "MARIA SOFIA DE OLIVEIRA" vs "MARIA SOFIA DE OLIVEIRA SANTOS").
    if (n.startsWith(buscado) || buscado.startsWith(n)) return false;
    return d.polo !== 'A';
  });

  // Se o polo não ajudou (todo mundo veio como 'A', comum em 1ª instância),
  // relaxa: qualquer parte que não seja a buscada vira candidata.
  const base =
    candidatos.length > 0
      ? candidatos
      : destinatarios.filter((d) => {
          const n = normalizarNome(d.nome);
          return !(n.startsWith(buscado) || buscado.startsWith(n));
        });

  const vistos = new Set<string>();
  const saida: DevedorClassificado[] = [];
  for (const d of base) {
    const chave = normalizarNome(d.nome);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(classificarDevedor(d.nome));
  }
  return saida;
}

/**
 * A classe que manda num processo com vários devedores: a mais "comprável"
 * ganha. Um processo contra o Estado e uma empresa é um processo contra o
 * Estado pro nosso propósito.
 */
const PRIORIDADE: Record<ClasseDevedor, number> = {
  federal: 0,
  estadual: 1,
  municipal: 2,
  estatal: 3,
  privado: 4,
};

export function classeDominante(devedores: readonly DevedorClassificado[]): ClasseDevedor {
  if (devedores.length === 0) return 'privado';
  return devedores.reduce((a, b) => (PRIORIDADE[a.classe] <= PRIORIDADE[b.classe] ? a : b)).classe;
}

export function ordemDeRelevancia(classe: ClasseDevedor): number {
  return PRIORIDADE[classe];
}
