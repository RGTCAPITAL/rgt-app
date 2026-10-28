import { redirect } from 'next/navigation';
import { exigirPerfil } from '@/lib/auth/roles';
import { iaConfigurada } from '@/lib/ia/client';
import { SectionHero } from '@/components/ui/section-hero';
import { MODELO_ROBO } from '@/lib/whatsapp/robo/claude';
import { Simulador } from './simulador';
import { PainelConexao } from './painel-conexao';

export default async function RoboPage() {
  const auth = await exigirPerfil(['admin', 'gestao']);
  if (!auth.ok) redirect('/');

  return (
    <div>
      <SectionHero
        title="Simulador do robô"
        subtitle="Você faz o papel do cliente. O robô responde de verdade, mas nada é gravado e nada vai pro WhatsApp."
        color="violet"
      />
      <PainelConexao />
      {iaConfigurada() ? (
        <Simulador modelo={MODELO_ROBO} />
      ) : (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          A chave da Anthropic não está configurada neste ambiente.
        </p>
      )}
    </div>
  );
}
