'use client';

import { CircleHelp, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Atalho da busca por nome no topo da Prospecção.
 *
 * O caso de uso é "alguém mandou um nome por WhatsApp, isso vira precatório?".
 * Como botão pequeno no canto do título ela passava despercebida; aqui o
 * campo já está pronto para digitar. É um <form> GET comum: leva para a página
 * de busca com ?nome=, e ela começa a pesquisar sozinha.
 */
export function CartaoBuscaNome() {
  return (
    <Card className="mb-6 border-neutral-300">
      <CardContent className="pt-5">
        <div className="mb-2 flex items-center gap-1.5">
          <Search className="size-4 text-neutral-700" />
          <span className="text-sm font-semibold text-neutral-900">
            Recebeu um nome por WhatsApp?
          </span>
          <TooltipProvider delay={150}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="O que é a busca por nome"
                    className="text-neutral-400 hover:text-neutral-700"
                  />
                }
              >
                <CircleHelp className="size-4" />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <div className="space-y-1.5 text-xs">
                  <p>
                    Procura os processos dessa pessoa no diário oficial da Justiça (DJEN) do{' '}
                    <strong>TRT19</strong>, <strong>TJAL</strong> e <strong>TRF5</strong>, só pelo
                    nome — sem precisar do número do processo.
                  </p>
                  <p>
                    Mostra primeiro os processos contra governo (União, Estado, INSS…), que são os
                    únicos que podem virar precatório. Os contra empresa ou pessoa ficam escondidos.
                  </p>
                  <p className="opacity-80">
                    Dica: digite só o primeiro nome ou um sobrenome. O diário casa o nome letra por
                    letra, e abreviação não acha nada. Leva até um minuto.
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <form action="/admin/prospeccao/buscar-por-nome" method="get" className="flex gap-2">
          <Input
            name="nome"
            required
            minLength={3}
            placeholder="Digite o nome da pessoa (ex.: Waldiria)"
            aria-label="Nome da pessoa"
            className="max-w-md"
          />
          <Button type="submit">
            <Search className="size-4" />
            Buscar
          </Button>
        </form>
        <p className="mt-2 text-xs text-neutral-500">
          Procura no TRT19, TJAL e TRF5 e separa o que pode virar precatório.
        </p>
      </CardContent>
    </Card>
  );
}
