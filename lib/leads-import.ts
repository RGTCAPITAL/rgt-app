/**
 * Parsing de planilha de leads.
 *
 * Separado de `lib/leads.ts` porque é coerção de dado sujo — planilha feita à
 * mão, cabeçalho livre, dinheiro em formato brasileiro, CNJ ora com máscara
 * ora sem. Tudo aqui é puro e testável.
 *
 * Regra que orienta o módulo: **nunca descartar em silêncio**. Coluna que o
 * importador não entende, coluna sem título, duas colunas brigando pelo mesmo
 * campo — tudo tem que aparecer na tela. Senão o usuário sobe a planilha, lê
 * "83 leads criados" e só descobre semanas depois que o valor não entrou.
 */

export type CampoImport =
  | 'nome'
  | 'telefone'
  | 'email'
  | 'cpf_cnpj'
  | 'numero_processo'
  | 'valor_processo'
  | 'valor_proposta_indicativa'
  | 'notas';

/**
 * Valor de célula preservando o tipo original.
 *
 * `number` é mantido de propósito: uma célula numérica do Excel com 3 casas
 * decimais (comum quando a coluna vem de fórmula, `=valor*0,65`) vira
 * "121810.727" se stringificada, e a heurística de milhar leria isso como
 * 121.810.727 — mil vezes maior. Depois de virar string a ambiguidade é
 * irrecuperável, porque "1.234" digitado à mão é milhar brasileiro.
 */
export type ValorCelula = string | number;

export type LinhaImport = Partial<Record<CampoImport, ValorCelula>> & {
  /** Linha real na planilha (1-based), pra mensagem de erro apontar certo. */
  linhaOrigem: number;
};

/** Célula como texto aparado, qualquer que seja o tipo de origem. */
export function texto(v: ValorCelula | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * Sinônimos de cabeçalho: chave é o cabeçalho normalizado, valor é o campo.
 *
 * Montado a partir de como as pessoas realmente nomeiam coluna em planilha.
 * Exigir cabeçalho exato faz o import falhar no primeiro clique e passa a
 * impressão de que o sistema é frágil.
 */
const SINONIMOS: Record<string, CampoImport> = {
  nome: 'nome',
  nome_completo: 'nome',
  nome_cliente: 'nome',
  cliente: 'nome',
  credor: 'nome',
  parte: 'nome',
  beneficiario: 'nome',
  exequente: 'nome',

  telefone: 'telefone',
  celular: 'telefone',
  fone: 'telefone',
  whatsapp: 'telefone',
  zap: 'telefone',
  contato: 'telefone',
  telefone_1: 'telefone',
  tel: 'telefone',

  email: 'email',
  e_mail: 'email',
  correio_eletronico: 'email',

  cpf: 'cpf_cnpj',
  cnpj: 'cpf_cnpj',
  cpf_cnpj: 'cpf_cnpj',
  cpfcnpj: 'cpf_cnpj',
  documento: 'cpf_cnpj',

  processo: 'numero_processo',
  numero_processo: 'numero_processo',
  n_processo: 'numero_processo',
  no_processo: 'numero_processo',
  num_processo: 'numero_processo',
  cnj: 'numero_processo',
  numero_cnj: 'numero_processo',
  processo_judicial: 'numero_processo',

  valor: 'valor_processo',
  valor_processo: 'valor_processo',
  valor_causa: 'valor_processo',
  valor_precatorio: 'valor_processo',
  valor_face: 'valor_processo',
  montante: 'valor_processo',

  proposta: 'valor_proposta_indicativa',
  valor_proposta: 'valor_proposta_indicativa',
  proposta_indicativa: 'valor_proposta_indicativa',
  eventual_proposta: 'valor_proposta_indicativa',
  oferta: 'valor_proposta_indicativa',

  notas: 'notas',
  observacao: 'notas',
  observacoes: 'notas',
  obs: 'notas',
  comentario: 'notas',
  comentarios: 'notas',
};

/**
 * Normaliza texto pra comparação: tira acento, baixa a caixa, troca
 * não-alfanumérico por underscore.
 *
 * "Nº do Processo" vira "n_do_processo"; "E-mail" vira "e_mail".
 */
export function normalizarTexto(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Resolve um cabeçalho pro campo correspondente, ou null se não reconhecer. */
export function resolverCampo(cabecalho: string): CampoImport | null {
  const norm = normalizarTexto(cabecalho);
  if (SINONIMOS[norm]) return SINONIMOS[norm];

  // "n_do_processo", "valor_do_processo" — remove conectores e tenta de novo,
  // em vez de inflar o mapa com cada combinação.
  const semConectores = norm.replace(/_(do|da|de|dos|das)_/g, '_');
  return SINONIMOS[semConectores] ?? null;
}

/**
 * Dinheiro em formato brasileiro.
 *
 * `parseFloat('R$ 187.430,00')` devolve 187.43 — erra por mil, em silêncio.
 * Essa função existe por causa desse bug específico.
 *
 * Célula numérica (`typeof v === 'number'`) não passa pela heurística: o Excel
 * já entregou o valor certo, qualquer reinterpretação só pode piorar.
 *
 * Para string, a ambiguidade do ponto sozinho: em planilha BR "1.234" é
 * milhar, não decimal. Mas "1.23" com duas casas é decimal, porque grupo de
 * milhar tem sempre 3 dígitos. É a heurística que erra menos com dado digitado.
 */
export function parseDinheiroBR(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null;
    return Math.round(v * 100) / 100;
  }

  let s = String(v).trim();
  if (!s) return null;

  s = s.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!s) return null;

  const negativo = s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'));
  s = s.replace(/[()\-+]/g, '');

  const temVirgula = s.includes(',');
  const temPonto = s.includes('.');

  if (temVirgula && temPonto) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    s = s.replace(',', '.');
  } else if (temPonto) {
    const partes = s.split('.');
    const ultimo = partes[partes.length - 1] ?? '';
    if (partes.length > 2 || ultimo.length === 3) s = partes.join('');
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || negativo) return null;
  return Math.round(n * 100) / 100;
}

/** Só os dígitos. Usado pra comparar CNJ, telefone e CPF entre fontes. */
export function somenteDigitos(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

/**
 * Valida CNJ pelo dígito verificador (módulo 97, Res. CNJ 65/2008).
 *
 * Checar só o tamanho deixa passar número digitado errado — e CNJ errado numa
 * planilha de 83 linhas só aparece quando alguém já ligou pra pessoa errada.
 */
export function cnjValido(cnj: string): boolean {
  const d = somenteDigitos(cnj);
  if (d.length !== 20) return false;

  const sequencial = d.slice(0, 7);
  const verificador = d.slice(7, 9);
  const resto = d.slice(9);
  const rearranjado = sequencial + resto + '00';

  // 22 dígitos estouram Number — resto de divisão iterativo
  let mod = 0;
  for (const ch of rearranjado) mod = (mod * 10 + Number(ch)) % 97;

  return 98 - mod === Number(verificador);
}

/** Rótulo de coluna no estilo do Excel: 0 vira A, 25 vira Z, 26 vira AA. */
export function rotuloColuna(col: number): string {
  let s = '';
  let n = col;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export type ColunaDuplicada = { cabecalho: string; campo: CampoImport; venceu: string };

export type ResultadoParse = {
  linhas: LinhaImport[];
  /** Cabeçalhos que o importador não reconheceu. */
  colunasIgnoradas: string[];
  /** Colunas com dados mas sem título — invisíveis se não avisadas. */
  colunasSemCabecalho: string[];
  /** Duas colunas disputando o mesmo campo; a primeira vence. */
  colunasDuplicadas: ColunaDuplicada[];
  camposDetectados: CampoImport[];
  /** Linha (1-based) onde o cabeçalho foi encontrado. */
  linhaCabecalho: number;
  erro: string | null;
};

const VAZIO: Omit<ResultadoParse, 'erro'> = {
  linhas: [],
  colunasIgnoradas: [],
  colunasSemCabecalho: [],
  colunasDuplicadas: [],
  camposDetectados: [],
  linhaCabecalho: 0,
};

/** Quantos campos DISTINTOS uma linha reconhece. */
function pontuarLinha(row: unknown[]): number {
  const campos = new Set<CampoImport>();
  for (const c of row) {
    const campo = resolverCampo(String(c ?? ''));
    if (campo) campos.add(campo);
  }
  return campos.size;
}

/**
 * Converte a matriz crua da planilha em linhas tipadas, informando tudo que
 * ficou de fora.
 *
 * Procura o cabeçalho nas 25 primeiras linhas em vez de assumir a primeira:
 * planilha de escritório costuma ter logo, título, legenda e bloco de
 * metadados antes da tabela. Exige ao menos 2 campos **distintos** pra não
 * eleger uma linha de metadados ("Cliente: Prefeitura") como cabeçalho —
 * quando isso acontece, o cabeçalho real vira o primeiro lead.
 */
export function parsePlanilha(matriz: unknown[][]): ResultadoParse {
  if (!matriz || matriz.length === 0) return { ...VAZIO, erro: 'Planilha vazia.' };

  let melhorIdx = -1;
  let melhorQtd = 1; // exige >= 2 campos distintos pra virar candidata
  const limite = Math.min(25, matriz.length);
  for (let i = 0; i < limite; i++) {
    const qtd = pontuarLinha(matriz[i] ?? []);
    if (qtd > melhorQtd) {
      melhorQtd = qtd;
      melhorIdx = i;
    }
  }

  // Planilha de coluna única (só nomes) é legítima: aceita 1 campo, mas só
  // se for a primeira linha — no meio do arquivo é quase certo ser metadado.
  if (melhorIdx === -1 && pontuarLinha(matriz[0] ?? []) === 1) melhorIdx = 0;

  if (melhorIdx === -1) {
    return {
      ...VAZIO,
      erro: 'Não encontrei cabeçalho reconhecível nas 25 primeiras linhas. A planilha precisa de uma linha com nomes de coluna (ex: Nome, Telefone, Processo).',
    };
  }

  const cabecalhos = (matriz[melhorIdx] ?? []).map((c) => String(c ?? '').trim());
  const mapa = cabecalhos.map(resolverCampo);

  if (!mapa.includes('nome')) {
    const lidos = cabecalhos.filter(Boolean).join(', ') || '(nenhum)';
    return {
      ...VAZIO,
      erro: `Nenhuma coluna de nome encontrada. Aceito: Nome, Nome Completo, Cliente, Credor, Parte, Exequente. Cabeçalhos lidos: ${lidos}`,
    };
  }

  // Colisão de campo: "Contato" e "Telefone" na mesma planilha. A primeira
  // vence, mas a segunda precisa aparecer — senão o telefone real some e nem
  // erro de validação aparece, porque o valor que entrou não tem dígitos.
  const primeiraPorCampo = new Map<CampoImport, string>();
  const colunasDuplicadas: ColunaDuplicada[] = [];
  const colunaUsada = new Map<CampoImport, number>();
  mapa.forEach((campo, i) => {
    if (!campo) return;
    const h = cabecalhos[i] ?? '';
    const anterior = primeiraPorCampo.get(campo);
    if (anterior === undefined) {
      primeiraPorCampo.set(campo, h);
      colunaUsada.set(campo, i);
    } else {
      colunasDuplicadas.push({ cabecalho: h || rotuloColuna(i), campo, venceu: anterior });
    }
  });

  // Largura real: uma coluna de dados pode existir além do cabeçalho.
  const larguraDados = matriz
    .slice(melhorIdx + 1)
    .reduce((m, r) => Math.max(m, (r ?? []).length), 0);
  const largura = Math.max(cabecalhos.length, larguraDados);

  const temDado = (col: number): boolean => {
    for (let i = melhorIdx + 1; i < matriz.length; i++) {
      const v = (matriz[i] ?? [])[col];
      if (v !== null && v !== undefined && String(v).trim() !== '') return true;
    }
    return false;
  };

  const colunasIgnoradas: string[] = [];
  const colunasSemCabecalho: string[] = [];
  for (let col = 0; col < largura; col++) {
    const h = cabecalhos[col] ?? '';
    if (h && !mapa[col]) colunasIgnoradas.push(h);
    else if (!h && temDado(col)) colunasSemCabecalho.push(rotuloColuna(col));
  }

  const camposDetectados = Array.from(primeiraPorCampo.keys());

  const linhas: LinhaImport[] = [];
  for (let i = melhorIdx + 1; i < matriz.length; i++) {
    const row = matriz[i] ?? [];
    const out: LinhaImport = { linhaOrigem: i + 1 };
    let temAlgo = false;

    for (const [campo, col] of colunaUsada) {
      const bruto = row[col];
      if (bruto === null || bruto === undefined || bruto === '') continue;
      // Preserva number — stringificar aqui é o que causava o erro de mil
      if (typeof bruto === 'number') {
        if (!Number.isFinite(bruto)) continue;
        out[campo] = bruto;
        temAlgo = true;
        continue;
      }
      const s = String(bruto).trim();
      if (!s) continue;
      out[campo] = s;
      temAlgo = true;
    }

    if (temAlgo) linhas.push(out);
  }

  return {
    linhas,
    colunasIgnoradas,
    colunasSemCabecalho,
    colunasDuplicadas,
    camposDetectados,
    linhaCabecalho: melhorIdx + 1,
    erro: null,
  };
}

/**
 * Chave de deduplicação.
 *
 * CPF quando existe. Senão CNJ **e** telefone juntos, nunca CNJ sozinho:
 * litisconsórcio trabalhista põe vários credores no mesmo processo, e dedup
 * por CNJ descartaria pessoas diferentes.
 */
export function chaveDedup(l: {
  numero_processo?: ValorCelula | null;
  telefone?: ValorCelula | null;
  cpf_cnpj?: ValorCelula | null;
}): string | null {
  const cpf = somenteDigitos(l.cpf_cnpj);
  if (cpf) return 'cpf:' + cpf;

  const cnj = somenteDigitos(l.numero_processo);
  const tel = somenteDigitos(l.telefone);
  if (cnj && tel) return 'cnj_tel:' + cnj + ':' + tel;
  if (tel) return 'tel:' + tel;
  return null;
}
