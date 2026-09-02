export const TIPOS_DOCUMENTO = [
  { value: 'oficio_requisitorio', label: 'Ofício Requisitório', grupo: 'processo' },
  { value: 'decisao_homologatoria', label: 'Decisão Homologatória', grupo: 'processo' },
  { value: 'calculos', label: 'Cálculos', grupo: 'processo' },
  { value: 'autos_processo', label: 'Autos do Processo', grupo: 'processo' },
  { value: 'procuracao', label: 'Procuração', grupo: 'processo' },
  { value: 'contrato_cessao', label: 'Contrato de Cessão', grupo: 'processo' },

  { value: 'rg', label: 'RG', grupo: 'identidade' },
  { value: 'cpf', label: 'CPF', grupo: 'identidade' },
  { value: 'comprovante_residencia', label: 'Comprovante de Residência', grupo: 'identidade' },
  { value: 'dados_bancarios', label: 'Dados Bancários', grupo: 'identidade' },

  { value: 'certidao_nascimento', label: 'Certidão de Nascimento', grupo: 'estado_civil' },
  { value: 'certidao_casamento', label: 'Certidão de Casamento', grupo: 'estado_civil' },

  { value: 'certidao_civel_tj_estadual', label: 'Cível TJ Estadual', grupo: 'certidoes' },
  { value: 'certidao_civel_federal_1_grau', label: 'Cível Federal 1º grau', grupo: 'certidoes' },
  { value: 'certidao_civel_federal_2_grau', label: 'Cível Federal 2º grau', grupo: 'certidoes' },
  { value: 'certidao_criminal_tj', label: 'Criminal TJ', grupo: 'certidoes' },
  { value: 'certidao_fiscal_tj', label: 'Fiscal TJ', grupo: 'certidoes' },

  { value: 'laudo_medico', label: 'Laudo médico (>75 anos)', grupo: 'especial' },
  { value: 'outro', label: 'Outro', grupo: 'especial' },
] as const;

export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]['value'];

export const GRUPOS = [
  { key: 'processo', label: 'Processo' },
  { key: 'identidade', label: 'Identidade' },
  { key: 'estado_civil', label: 'Estado civil' },
  { key: 'certidoes', label: 'Certidões (due diligence)' },
  { key: 'especial', label: 'Outros' },
] as const;

export function labelTipoDoc(tipo: string): string {
  return TIPOS_DOCUMENTO.find((t) => t.value === tipo)?.label ?? tipo;
}

/**
 * Contexto do cedente pra derivar obrigatórios contextuais.
 */
export type ContextoCedente = {
  dataNascimento?: string | null;  // ISO yyyy-mm-dd
  estadoCivil?: string | null;     // 'solteiro' | 'casado' | ...
};

function calcularIdade(dataNascISO: string): number {
  // Sem timezone shift: parseia componentes locais
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataNascISO);
  if (!m) return 0;
  const [, y, mo, d] = m.map(Number) as [string, number, number, number];
  const hoje = new Date();
  let idade = hoje.getFullYear() - Number(y);
  const mesAtual = hoje.getMonth() + 1;
  const diaAtual = hoje.getDate();
  if (mesAtual < mo || (mesAtual === mo && diaAtual < d)) idade--;
  return idade;
}

/**
 * Retorna quais tipos são obrigatórios pra este tipo de operação.
 * Se contexto do cedente fornecido, adiciona regras derivadas:
 *   - idade > 75 → laudo_medico
 *   - casado → certidao_casamento; senão → certidao_nascimento
 */
export function tiposObrigatorios(tipoAtivo: string, ctx?: ContextoCedente): TipoDocumento[] {
  const base: TipoDocumento[] = ['rg', 'cpf', 'comprovante_residencia', 'dados_bancarios'];
  const obrig = [...base];

  if (tipoAtivo === 'precatorio' || tipoAtivo === 'rpv') {
    obrig.push('oficio_requisitorio');
  }
  if (
    tipoAtivo === 'direito_creditorio' ||
    tipoAtivo === 'pre_precatorio' ||
    tipoAtivo === 'pre_rpv'
  ) {
    obrig.push('decisao_homologatoria', 'calculos');
  }

  if (ctx?.dataNascimento) {
    const idade = calcularIdade(ctx.dataNascimento);
    if (idade > 75) obrig.push('laudo_medico');
  }

  if (ctx?.estadoCivil) {
    if (ctx.estadoCivil === 'casado') obrig.push('certidao_casamento');
    else obrig.push('certidao_nascimento');
  }

  return obrig;
}

/**
 * Retorna mensagens de aviso contextual (pra exibir no topo do checklist).
 */
export function avisosCedente(ctx?: ContextoCedente): string[] {
  const avisos: string[] = [];
  if (ctx?.dataNascimento) {
    const idade = calcularIdade(ctx.dataNascimento);
    if (idade > 75) {
      avisos.push(`Cedente tem ${idade} anos (>75) → laudo médico obrigatório.`);
    }
  }
  if (ctx?.estadoCivil === 'casado') {
    avisos.push('Cedente casado → certidão de casamento obrigatória.');
  } else if (ctx?.estadoCivil) {
    avisos.push('Cedente não casado → certidão de nascimento obrigatória.');
  }
  return avisos;
}
