import { FlaskConical } from 'lucide-react';

/**
 * Marca visual de registro de demonstração.
 *
 * Existe porque o banco mistura dado inventado (operações e leads de seed,
 * criados pra testar o fluxo) com dado real (prospecções do TRT19,
 * publicações do DJEN). Quem entra pela primeira vez não tem como saber a
 * diferença, e nome inventado parece gente de verdade.
 *
 * Quando os dados de demo forem limpos, o selo some sozinho — nenhum
 * registro vai ter `is_exemplo` verdadeiro.
 */
export function SeloExemplo({ className = '' }: { className?: string }) {
  return (
    <span
      title="Registro de demonstração — não é uma operação real da RGT"
      className={`inline-flex shrink-0 items-center gap-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ${className}`}
    >
      <FlaskConical className="size-2.5" />
      exemplo
    </span>
  );
}
