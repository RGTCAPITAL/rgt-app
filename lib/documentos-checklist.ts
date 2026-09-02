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
 * Retorna quais tipos são obrigatórios pra este tipo de operação.
 * Regras que dependem de campos não modelados (data nascimento, estado civil)
 * ficam de fora — Ver desvios da RGT-22.
 */
export function tiposObrigatorios(tipoAtivo: string): TipoDocumento[] {
  const base: TipoDocumento[] = ['rg', 'cpf', 'comprovante_residencia', 'dados_bancarios'];

  if (tipoAtivo === 'precatorio' || tipoAtivo === 'rpv') {
    return [...base, 'oficio_requisitorio'];
  }
  if (
    tipoAtivo === 'direito_creditorio' ||
    tipoAtivo === 'pre_precatorio' ||
    tipoAtivo === 'pre_rpv'
  ) {
    return [...base, 'decisao_homologatoria', 'calculos'];
  }
  return base;
}
