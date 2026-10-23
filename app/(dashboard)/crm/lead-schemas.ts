import { z } from 'zod';

const somenteDigitos = (s: string) => s.replace(/\D/g, '');

/**
 * Guarda o "+" de número estrangeiro.
 *
 * Com `somenteDigitos`, "+1 415 555 0100" virava "14155550100" — e aí o
 * `fmtTelefone` lia "14" como DDD de Marília e mostrava "(14) 15555-0100".
 * O "+" é o único sinal que diz "não é brasileiro"; perdê-lo na escrita
 * torna o erro impossível de corrigir na exibição.
 *
 * "+55" segue virando dígito puro: é brasileiro, tem DDD, e o resto do
 * sistema já sabe tirar o 55.
 */
const normalizarTelefone = (s: string) => {
  const d = somenteDigitos(s);
  return s.trim().startsWith('+') && !d.startsWith('55') ? `+${d}` : d;
};

export const leadFormSchema = z.object({
  nome: z.string().trim().min(2, 'Nome muito curto'),
  telefone: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? normalizarTelefone(v) : ''))
    .refine(
      // O "+" não conta como dígito na validação de tamanho.
      (v) => !v || (somenteDigitos(v).length >= 10 && somenteDigitos(v).length <= 13),
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
    .refine((v) => !v || v.length === 11 || v.length === 14, 'CPF (11) ou CNPJ (14) dígitos'),
  origem: z.enum(['whatsapp', 'site', 'indicacao', 'linkedin', 'evento', 'outro']),
  dono_id: z.string().uuid().optional().or(z.literal('')),
  notas: z.string().trim().optional().or(z.literal('')),

  // Dados do precatório. Opcionais: um lead que chegou por indicação começa
  // só com nome e telefone, e o broker descobre o resto na conversa. São os
  // campos que a mensagem de primeiro contato consome — sem o ente, o texto
  // que cita "contra {ente}" é descartado em favor de um mais simples.
  ente_devedor: z.string().trim().optional().or(z.literal('')),
  numero_processo: z.string().trim().optional().or(z.literal('')),
  // Chega como texto porque a pessoa digita "187.430,50". A conversão pra
  // número acontece na action, junto com a validação de que virou número.
  valor_processo: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || Number.isFinite(valorParaNumero(v)), 'Valor inválido')
    .refine((v) => !v || valorParaNumero(v) >= 0, 'Valor não pode ser negativo'),
});

/**
 * "187.430,50" -> 187430.5
 *
 * No português o ponto separa milhar e a vírgula marca o decimal — o
 * inverso do que `Number()` espera. Trocar só a vírgula por ponto, como o
 * resto do projeto faz, erra em "187.430,50": sobra "187.430.50" e o
 * `Number()` devolve NaN.
 */
export function valorParaNumero(bruto: string): number {
  const limpo = bruto.trim().replace(/\s/g, '').replace(/R\$/i, '');
  if (!limpo) return NaN;
  // Com vírgula, o ponto só pode ser milhar. Sem vírgula, o ponto é decimal.
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  return Number(normalizado);
}

export type LeadFormData = z.infer<typeof leadFormSchema>;
