/**
 * As tarefas da regra "processo andou" trazem linhas
 * "Publicação de 27/10/2026: https://…". Dentro do cartão (que é um <Link>
 * pro lead ou pra operação) a URL não abre: âncora dentro de âncora é HTML
 * inválido e o clique vai pro cartão. Aqui elas saem do texto e viram links
 * próprios, mostrados fora do cartão.
 */
export interface LinkDaTarefa {
  rotulo: string;
  url: string;
}

const LINHA = /^Publicação de (\d{2}\/\d{2}\/\d{4}): (https?:\/\/\S+)$/;

export function separarLinks(descricao: string | null): {
  texto: string | null;
  links: LinkDaTarefa[];
} {
  if (!descricao) return { texto: descricao, links: [] };
  const links: LinkDaTarefa[] = [];
  const resto: string[] = [];
  for (const linha of descricao.split('\n')) {
    const m = LINHA.exec(linha.trim());
    if (m) links.push({ rotulo: `Abrir publicação de ${m[1]}`, url: m[2]! });
    else resto.push(linha);
  }
  return { texto: resto.join('\n').trim() || null, links };
}
