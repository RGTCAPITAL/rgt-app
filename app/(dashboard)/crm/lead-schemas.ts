import { z } from 'zod';

const somenteDigitos = (s: string) => s.replace(/\D/g, '');

export const leadFormSchema = z.object({
  nome: z.string().trim().min(2, 'Nome muito curto'),
  telefone: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? somenteDigitos(v) : ''))
    .refine(
      (v) => !v || (v.length >= 10 && v.length <= 13),
      'Telefone deve ter 10-13 dígitos (com DDD)',
    ),
  email: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Email inválido'),
  cpf_cnpj: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? somenteDigitos(v) : ''))
    .refine(
      (v) => !v || v.length === 11 || v.length === 14,
      'CPF (11) ou CNPJ (14) dígitos',
    ),
  origem: z.enum(['whatsapp', 'site', 'indicacao', 'linkedin', 'evento', 'outro']),
  dono_id: z.string().uuid().optional().or(z.literal('')),
  notas: z.string().trim().optional().or(z.literal('')),
});

export type LeadFormData = z.infer<typeof leadFormSchema>;
