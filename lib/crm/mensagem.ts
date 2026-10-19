/**
 * Monta a mensagem de primeiro contato que vai pré-preenchida no WhatsApp.
 *
 * O broker clica no card, a conversa abre com o texto escrito, ele revisa e
 * manda. Continua sendo ele quem envia, do aparelho dele — o que mantém zero
 * risco de bloqueio e não depende da verificação da Meta.
 *
 * REGRA QUE ORIENTA O MÓDULO: a mensagem nunca sai com buraco. Se um dado
 * falta, o modelo que o exige é descartado em favor de um mais simples —
 * melhor uma frase curta e correta do que "seu precatório de R$ undefined".
 */

export type DadosLead = {
  nome: string;
  valorProposta: number | null;
  valorProcesso: number | null;
  numeroProcesso: string | null;
  enteDevedor: string | null;
};

export type ModeloMensagem = {
  id: string;
  nome: string;
  texto: string;
  /** Modelos que citam valor só servem pra lead que tem valor. */
  requerValor: boolean;
  requerEnte: boolean;
};

/**
 * Primeiro nome, para a mensagem não soar like formulário.
 *
 * "Olá José" lê melhor que "Olá José Ribamar da Silva Filho". Preposições
 * ficam de fora: "Maria da Conceição" vira "Maria", não "Maria da".
 */
export function primeiroNome(nomeCompleto: string): string {
  const limpo = nomeCompleto.trim();
  if (!limpo) return '';
  const primeiro = limpo.split(/\s+/)[0] ?? '';
  // Nome de uma letra só costuma ser inicial — aí o nome inteiro é melhor.
  return primeiro.length <= 2 ? limpo : primeiro;
}

/**
 * Moeda com espaço comum entre símbolo e número.
 *
 * `toLocaleString('pt-BR')` separa "R$" do valor com espaço não-quebrável
 * (U+00A0). É invisível na tela e inofensivo no WhatsApp, mas vaza para
 * qualquer comparação de texto e para a URL, onde vira %C2%A0. Normalizar
 * aqui evita a surpresa em todo lugar que consome a mensagem.
 */
const fmtBRL = (v: number) =>
  v
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
    .replace(/ /g, ' ');

/**
 * Siglas que devem continuar em caixa alta. Aplicar título a elas produz
 * "Inss" e "Incra", que lê como erro de digitação.
 */
const SIGLAS = new Set([
  'INSS',
  'INCRA',
  'ECT',
  'CEF',
  'BB',
  'DNIT',
  'IBAMA',
  'FUNAI',
  'ANAC',
  'INMETRO',
  'IBGE',
  'INEP',
  'FNDE',
  'CNEN',
  'SUDENE',
  'UFAL',
  'UFPE',
  'IFAL',
]);

const ESTADOS = new Set([
  'ACRE',
  'ALAGOAS',
  'AMAPA',
  'AMAZONAS',
  'BAHIA',
  'CEARA',
  'ESPIRITO SANTO',
  'GOIAS',
  'MARANHAO',
  'MATO GROSSO',
  'MATO GROSSO DO SUL',
  'MINAS GERAIS',
  'PARA',
  'PARAIBA',
  'PARANA',
  'PERNAMBUCO',
  'PIAUI',
  'RIO DE JANEIRO',
  'RIO GRANDE DO NORTE',
  'RIO GRANDE DO SUL',
  'RONDONIA',
  'RORAIMA',
  'SANTA CATARINA',
  'SAO PAULO',
  'SERGIPE',
  'TOCANTINS',
  'DISTRITO FEDERAL',
]);

/** Grafias corretas, já que a planilha do tribunal chega sem acento. */
const ACENTUADOS: Record<string, string> = {
  AMAPA: 'Amapá',
  CEARA: 'Ceará',
  'ESPIRITO SANTO': 'Espírito Santo',
  GOIAS: 'Goiás',
  MARANHAO: 'Maranhão',
  PARA: 'Pará',
  PARAIBA: 'Paraíba',
  PARANA: 'Paraná',
  PIAUI: 'Piauí',
  RONDONIA: 'Rondônia',
  'SAO PAULO': 'São Paulo',
};

function tituloSimples(s: string): string {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return s
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((palavra, i) =>
      i > 0 && minusculas.has(palavra)
        ? palavra
        : palavra.charAt(0).toLocaleUpperCase('pt-BR') + palavra.slice(1),
    )
    .join(' ');
}

/**
 * Deixa o nome do devedor apresentável na mensagem.
 *
 * A planilha do tribunal entrega "ALAGOAS", e a frase "crédito a receber de
 * ALAGOAS" soa como erro. Aqui vira "Estado de Alagoas". Siglas são
 * preservadas e nomes compostos ganham as preposições em minúscula.
 */
export function formatarEnte(bruto: string | null): string | null {
  if (!bruto) return null;
  const limpo = bruto.trim().replace(/\s+/g, ' ');
  if (!limpo) return null;

  const chave = limpo.toLocaleUpperCase('pt-BR');
  if (SIGLAS.has(chave)) return chave;
  if (ESTADOS.has(chave)) return `Estado de ${ACENTUADOS[chave] ?? tituloSimples(chave)}`;
  return tituloSimples(limpo);
}

/** Variáveis que um modelo pode usar, documentadas pra quem edita o texto. */
export const VARIAVEIS_DISPONIVEIS = [
  { chave: '{nome}', descricao: 'Primeiro nome da pessoa' },
  { chave: '{nome_completo}', descricao: 'Nome como está cadastrado' },
  { chave: '{valor}', descricao: 'Valor da proposta ou do processo' },
  { chave: '{ente}', descricao: 'Quem deve (Estado de Alagoas, INSS…)' },
  { chave: '{processo}', descricao: 'Número do processo' },
] as const;

/** Substitui as variáveis do modelo pelos dados do lead. */
export function montarMensagem(texto: string, lead: DadosLead): string {
  const valor = lead.valorProposta ?? lead.valorProcesso;

  return (
    texto
      .replaceAll('{nome_completo}', lead.nome.trim())
      .replaceAll('{nome}', primeiroNome(lead.nome))
      .replaceAll('{valor}', valor !== null ? fmtBRL(valor) : '')
      .replaceAll('{ente}', formatarEnte(lead.enteDevedor) ?? '')
      .replaceAll('{processo}', lead.numeroProcesso ?? '')
      // Espaço duplo e espaço antes de pontuação denunciam variável vazia que
      // escapou. Limpar depois é mais robusto que prever cada combinação.
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.!?])/g, '$1')
      .trim()
  );
}

/**
 * Escolhe o modelo mais completo que os dados do lead sustentam.
 *
 * Os modelos vêm ordenados do mais específico ao mais genérico; o primeiro
 * cujos requisitos o lead atende vence. Assim um lead sem valor recebe a
 * versão curta em vez de uma frase com buraco.
 */
export function escolherModelo(modelos: ModeloMensagem[], lead: DadosLead): ModeloMensagem | null {
  const temValor = (lead.valorProposta ?? lead.valorProcesso) !== null;
  const temEnte = Boolean(lead.enteDevedor?.trim());

  const servem = modelos.filter((m) => (!m.requerValor || temValor) && (!m.requerEnte || temEnte));
  return servem[0] ?? null;
}

/**
 * Link que abre a conversa com a mensagem pronta.
 *
 * O WhatsApp corta mensagem muito longa na URL e alguns navegadores limitam
 * o tamanho total — 1200 caracteres é folgado pro que cabe num primeiro
 * contato e seguro em qualquer cliente.
 */
const LIMITE_TEXTO = 1200;

export function linkWhatsAppComTexto(telefone: string, mensagem: string): string {
  const digitos = telefone.replace(/\D/g, '');
  // Número brasileiro sem DDI: 11 dígitos com o nono, 10 sem.
  const comDdi = digitos.length <= 11 ? '55' + digitos : digitos;
  const texto = mensagem.slice(0, LIMITE_TEXTO);
  return `https://wa.me/${comDdi}?text=${encodeURIComponent(texto)}`;
}
