'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  AlertTriangle,
  Building2,
  Copy,
  Info,
  Landmark,
  Search,
  User,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionHero } from '@/components/ui/section-hero';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { ClasseDevedor } from '@/lib/djen/devedor-publico';
import type { ProcessoEncontrado, ResultadoBusca } from '@/lib/djen/busca-por-nome';
import { buscarNomeNoDjen } from './actions';
import { DialogCriarLead, type ProcessoParaLead } from './dialog-criar-lead';

const TRIBUNAIS = [
  { sigla: 'TRT19', rotulo: 'TRT19 — trabalhista de Alagoas' },
  { sigla: 'TJAL', rotulo: 'TJAL — justiça estadual' },
  { sigla: 'TRF5', rotulo: 'TRF5 — justiça federal' },
];

const SELO: Record<ClasseDevedor, { texto: string; classe: string }> = {
  federal: { texto: 'Federal', classe: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  estadual: { texto: 'Estadual', classe: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  municipal: {
    texto: 'Municipal — bloqueada hoje',
    classe: 'border-amber-300 bg-amber-50 text-amber-900',
  },
  estatal: {
    texto: 'Estatal — não gera precatório',
    classe: 'border-neutral-300 bg-neutral-50 text-neutral-700',
  },
  privado: { texto: 'Privado', classe: 'border-neutral-300 bg-neutral-50 text-neutral-600' },
};

function mascararCnj(cnj: string): string {
  if (cnj.length !== 20) return cnj;
  return `${cnj.slice(0, 7)}-${cnj.slice(7, 9)}.${cnj.slice(9, 13)}.${cnj.slice(13, 14)}.${cnj.slice(14, 16)}.${cnj.slice(16)}`;
}

function LinhaProcesso({
  p,
  onCriarLead,
}: {
  p: ProcessoEncontrado;
  onCriarLead?: (p: ProcessoParaLead) => void;
}) {
  const selo = SELO[p.classe];
  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        p.comprado ? 'border-emerald-200 bg-emerald-50/30' : 'border-neutral-200',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{mascararCnj(p.cnj)}</span>
        <Badge variant="outline" className="text-xs">
          {p.siglaTribunal}
        </Badge>
        <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', selo.classe)}>
          {selo.texto}
        </span>
      </div>

      <div className="mt-2 flex items-start gap-2 text-sm text-neutral-700">
        {p.classe === 'privado' || p.classe === 'estatal' ? (
          <Building2 className="mt-0.5 size-4 shrink-0 text-neutral-400" />
        ) : (
          <Landmark className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        )}
        <span>
          {p.devedores.length > 0 ? (
            <>
              contra <strong>{p.devedores.map((d) => d.nome).join(', ')}</strong>
            </>
          ) : (
            <span className="text-neutral-500">
              parte contrária não identificada nas publicações
            </span>
          )}
        </span>
      </div>

      {p.nosAutos.length > 0 && (
        <div className="mt-1 flex items-start gap-2 text-sm text-neutral-600">
          <User className="mt-0.5 size-4 shrink-0 text-neutral-400" />
          <span>nos autos: {p.nosAutos.join(' / ')}</span>
        </div>
      )}

      <div className="mt-2 text-xs text-neutral-500">
        {p.orgao} · {p.publicacoes} publicaç{p.publicacoes === 1 ? 'ão' : 'ões'} ·{' '}
        {p.primeiraPublicacao} a {p.ultimaPublicacao}
      </div>

      {p.fase.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.fase.map((f) => (
            <Badge key={f} variant="secondary" className="text-xs">
              {f}
            </Badge>
          ))}
        </div>
      )}

      {/* Próximo passo: antes a busca só informava, e o advogado redigitava
          tudo no CRM. Só em processo contra governo — os outros não viram
          precatório, e um botão ali só convidaria ao erro. */}
      {p.comprado && onCriarLead && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onCriarLead({ ...p, cnjExibido: mascararCnj(p.cnj) })}>
            <UserPlus className="size-3.5" />
            Criar lead
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard
                .writeText(mascararCnj(p.cnj))
                .then(() => toast.success('Número copiado'))
                .catch(() => toast.error('Não consegui copiar. Selecione o número e copie à mão.'));
            }}
          >
            <Copy className="size-3.5" />
            Copiar nº
          </Button>
        </div>
      )}
    </div>
  );
}

export function BuscaForm({ nomeInicial }: { nomeInicial?: string }) {
  const [resultado, setResultado] = useState<ResultadoBusca | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarResto, setMostrarResto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const [paraLead, setParaLead] = useState<ProcessoParaLead | null>(null);

  function onSubmit(formData: FormData) {
    setErro(null);
    setMostrarResto(false);
    iniciar(async () => {
      const r = await buscarNomeNoDjen(formData);
      if (r.ok) setResultado(r.data);
      else {
        setResultado(null);
        setErro(r.error);
      }
    });
  }

  // Chegou com ?nome= (cartão da Prospecção): roda a busca uma vez, nos três
  // tribunais. O ref segura o double-invoke do StrictMode em dev.
  const jaBuscou = useRef(false);
  useEffect(() => {
    if (!nomeInicial || jaBuscou.current) return;
    jaBuscou.current = true;
    const fd = new FormData();
    fd.set('nome', nomeInicial);
    for (const t of TRIBUNAIS) fd.append('tribunais', t.sigla);
    onSubmit(fd);
  }, [nomeInicial]);

  const comprados = resultado?.processos.filter((p) => p.comprado) ?? [];
  const resto = resultado?.processos.filter((p) => !p.comprado) ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <SectionHero
        title="Buscar processo por nome"
        subtitle="Varre o diário do CNJ e mostra primeiro os processos cujo devedor é ente público — os únicos que podem virar precatório."
        color="blue"
      />

      <Card className="mt-6">
        <CardContent className="pt-6">
          {/* onSubmit, não action: com action o React 19 limpa o form ao terminar, e o
              broker perde o nome que acabou de testar e os tribunais que desmarcou. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit(new FormData(e.currentTarget));
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="nome">Nome da pessoa</Label>
              <Input
                id="nome"
                name="nome"
                defaultValue={nomeInicial}
                required
                minLength={3}
                placeholder="Waldiria Maria Siqueira Ayres"
                className="mt-1"
              />
              <p className="mt-1 text-xs text-neutral-500">
                O diário casa o nome <strong>literalmente</strong>. Se não achar, tente só o
                primeiro nome ou um sobrenome — abreviação quebra a busca.
              </p>
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-neutral-700">Tribunais</legend>
              <div className="mt-2 space-y-1">
                {TRIBUNAIS.map((t) => (
                  <label key={t.sigla} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="tribunais"
                      value={t.sigla}
                      defaultChecked
                      className="size-4 rounded border-neutral-300"
                    />
                    {t.rotulo}
                  </label>
                ))}
              </div>
            </fieldset>

            <Button type="submit" disabled={pendente} className="w-full sm:w-auto">
              {pendente ? <Spinner className="mr-2 size-4" /> : <Search className="mr-2 size-4" />}
              {pendente ? 'Varrendo o diário...' : 'Buscar'}
            </Button>
            {pendente && (
              <p className="text-xs text-neutral-500">
                Pode levar até um minuto: o diário limita 20 consultas por minuto e varremos um
                tribunal por vez.
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {erro && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {erro}
        </div>
      )}

      {resultado && (
        <div className="mt-6 space-y-4">
          {resultado.avisos.map((a) => (
            <div
              key={a}
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <Info className="mt-0.5 size-4 shrink-0" />
              {a}
            </div>
          ))}

          {resultado.processos.length > 0 && (
            <p className="text-sm text-neutral-600">
              <strong>&ldquo;{resultado.nome}&rdquo;</strong>: {resultado.processos.length} processo
              {resultado.processos.length === 1 ? '' : 's'} em {resultado.totalPublicacoes}{' '}
              publicações · <strong>{comprados.length}</strong> com devedor público
            </p>
          )}

          {comprados.length > 0 && (
            <div className="space-y-3">
              {comprados.map((p) => (
                <LinhaProcesso
                  key={`${p.siglaTribunal}-${p.cnj}`}
                  p={p}
                  onCriarLead={setParaLead}
                />
              ))}
            </div>
          )}

          {/* Um botão só, que alterna: antes ele mostrava e sumia, sem jeito de
              esconder de novo a lista de quem não vira precatório. */}
          {resto.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setMostrarResto((v) => !v)}
              className="w-full"
              aria-expanded={mostrarResto}
            >
              {mostrarResto ? 'Esconder' : 'Mostrar'} os {resto.length} sem devedor público
            </Button>
          )}

          {mostrarResto && (
            <div className="space-y-3 opacity-80">
              {resto.map((p) => (
                <LinhaProcesso key={`${p.siglaTribunal}-${p.cnj}`} p={p} />
              ))}
            </div>
          )}
        </div>
      )}

      <DialogCriarLead
        key={paraLead?.cnj ?? 'fechado'}
        processo={paraLead}
        onFechar={() => setParaLead(null)}
      />
    </div>
  );
}
