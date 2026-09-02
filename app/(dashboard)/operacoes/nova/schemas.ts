import { z } from 'zod';

export const TIPOS_ATIVO = [
  { value: 'precatorio', label: 'Precatório' },
  { value: 'rpv', label: 'RPV' },
  { value: 'pre_precatorio', label: 'Pré-Precatório' },
  { value: 'pre_rpv', label: 'Pré-RPV' },
  { value: 'direito_creditorio', label: 'Direito Creditório' },
] as const;

export const ESFERAS = [
  { value: 'federal', label: 'Federal' },
  { value: 'estadual', label: 'Estadual' },
  { value: 'municipal', label: 'Municipal' },
] as const;

export const NATUREZAS = [
  { value: 'alimentar', label: 'Alimentar' },
  { value: 'comum', label: 'Comum' },
  { value: 'tributaria', label: 'Tributária' },
] as const;

export const ESPECIES = [
  { value: 'credito_total', label: 'Crédito total (servidor + advogado)' },
  { value: 'apenas_principal', label: 'Apenas principal' },
  { value: 'honorarios', label: 'Honorários' },
] as const;

const somenteDigitos = (s: string) => s.replace(/\D/g, '');

export const step1Schema = z.object({
  cedente_nome: z.string().trim().min(3, 'Nome do cedente é obrigatório'),
  cedente_cpf: z
    .string()
    .transform(somenteDigitos)
    .refine((v) => v.length === 11, 'CPF deve ter 11 dígitos'),
  numero_processo: z.string().trim().min(20, 'Número do processo parece inválido'),
  tipo: z.enum(['precatorio', 'rpv', 'pre_precatorio', 'pre_rpv', 'direito_creditorio']),
  natureza: z.enum(['alimentar', 'comum', 'tributaria']),
  esfera: z.enum(['federal', 'estadual', 'municipal']),
  tribunal: z.string().trim().min(1, 'Selecione o tribunal'),
  ente_devedor_id: z.string().uuid('Selecione o ente devedor'),
  especie: z.enum(['credito_total', 'apenas_principal', 'honorarios']),
  data_base: z.string().min(1, 'Data-base é obrigatória'),
  data_autuacao: z.string().optional().or(z.literal('')),
  loa: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine(
      (v) => !v || (/^\d{4}$/.test(v) && Number(v) >= 2020 && Number(v) <= 2050),
      'LOA deve ser ano entre 2020 e 2050',
    ),
});

export const step2Schema = z
  .object({
    valor_principal: z
      .string()
      .min(1, 'Informe o valor principal')
      .refine((v) => Number(v.replace(',', '.')) >= 0, 'Valor inválido'),
    valor_juros: z
      .string()
      .min(1, 'Informe o valor dos juros')
      .refine((v) => Number(v.replace(',', '.')) >= 0, 'Valor inválido'),
    valor_selic: z
      .string()
      .optional()
      .or(z.literal(''))
      .refine(
        (v) => !v || Number(v.replace(',', '.')) >= 0,
        'Valor inválido',
      ),
    retencao_honorarios_pct: z
      .string()
      .refine((v) => {
        const n = Number(v.replace(',', '.'));
        return n >= 0 && n <= 100;
      }, 'Percentual entre 0 e 100'),
    percentual_aquisicao: z
      .string()
      .refine((v) => {
        const n = Number(v.replace(',', '.'));
        return n > 0 && n <= 100;
      }, 'Percentual entre 0 (exclusive) e 100'),
    pss_ativo: z.boolean(),
    pss_pct: z.string().optional().or(z.literal('')),
    rra_ativo: z.boolean(),
    rra_meses: z.string().optional().or(z.literal('')),
    observacoes: z.string().optional().or(z.literal('')),
  })
  .refine(
    (data) => {
      if (!data.pss_ativo) return true;
      const n = Number((data.pss_pct ?? '').replace(',', '.'));
      return n >= 0 && n <= 100;
    },
    { message: 'Informe percentual PSS válido (0-100)', path: ['pss_pct'] },
  )
  .refine(
    (data) => {
      if (!data.rra_ativo) return true;
      const n = Number(data.rra_meses ?? '');
      return Number.isInteger(n) && n >= 0;
    },
    { message: 'Informe meses RRA (inteiro ≥ 0)', path: ['rra_meses'] },
  );

export const step3Schema = z.object({
  aceite_termos: z.boolean().refine((v) => v === true, 'Confirme o envio da solicitação'),
});

export type Step1Data = z.infer<typeof step1Schema>;
export type Step2Data = z.infer<typeof step2Schema>;
export type Step3Data = z.infer<typeof step3Schema>;
