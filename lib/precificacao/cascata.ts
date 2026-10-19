/**
 * A cascata: do valor do ofício até o líquido disponível.
 *
 * Esta é a conta que o Renato faz no Excel hoje. Ela existe como função pura
 * pra rodar igual no servidor (ao gravar) e no cliente (ao digitar), sem
 * chance de a tela divergir do que foi salvo.
 *
 * REGRA QUE ORIENTA O MÓDULO: nenhuma linha exibe número que não foi lido do
 * ofício ou digitado por uma pessoa. "Falta" é um estado nomeado, não um zero
 * silencioso. Assumir 11% de PSS porque é o padrão da lei produz um total que
 * parece exato e está errado — e é exatamente o tipo de erro que só aparece
 * depois da proposta enviada.
 *
 * O deságio NÃO mora aqui. A cascata vai até o líquido disponível, que é
 * norma (Res. CJF 983/2026 art. 22). O deságio é decisão comercial da RGT e
 * depende de parâmetros que o Renato define.
 */

import type { Bloqueio, EntradaCascata, LinhaCascata, ResultadoCascata } from './tipos';

/** Centavos. Dinheiro não carrega fração de centavo entre linhas. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const NORMA_CESSAO = 'Res. CJF 983/2026, art. 22';
const NORMA_PSS = 'Lei 10.887/2004, art. 16-A';
const NORMA_RRA = 'Lei 7.713/88, art. 12-A';

function rotuloIndice(indice: string): string {
  const mapa: Record<string, string> = {
    selic: 'Selic',
    ipca: 'IPCA',
    ipca_15: 'IPCA-15',
    inpc: 'INPC',
    poupanca: 'Poupança',
    tr: 'TR',
  };
  return mapa[indice] ?? indice.toUpperCase();
}

/** '2024-02-16' → '02/2024' */
function mesAno(dataIso: string): string {
  const [ano, mes] = dataIso.split('-');
  return `${mes}/${ano}`;
}

export function montarCascata(entrada: EntradaCascata): ResultadoCascata {
  const { composicao, deducoes, tributacao, dataFinal, fatorCorrecao } = entrada;
  const linhas: LinhaCascata[] = [];
  const bloqueios: Bloqueio[] = [];

  // ---- Composição na data-base, exatamente como o ofício traz ----

  linhas.push({
    id: 'principal',
    rotulo: 'Principal',
    valor: composicao.principal,
    sinal: '+',
    origem: 'oficio',
    detalhe: `posição em ${mesAno(composicao.dataBase)}`,
  });

  linhas.push({
    id: 'juros',
    rotulo: 'Juros moratórios',
    valor: composicao.juros,
    sinal: '+',
    origem: 'oficio',
  });

  linhas.push({
    id: 'correcao-oficio',
    rotulo: `Correção até a data-base (${rotuloIndice(composicao.indice)})`,
    valor: composicao.correcao,
    sinal: '+',
    origem: 'oficio',
    detalhe: 'aplicada pelo tribunal no cálculo homologado',
  });

  const brutoDataBase = round2(composicao.principal + composicao.juros + composicao.correcao);

  linhas.push({
    id: 'bruto-data-base',
    rotulo: `Bruto em ${mesAno(composicao.dataBase)}`,
    valor: brutoDataBase,
    sinal: '=',
    origem: 'calculado',
    destaque: true,
  });

  // ---- Correção da data-base até hoje ----
  //
  // O ofício para na data do cálculo homologado. Entre aquela data e hoje o
  // crédito continuou corrigindo, e é esse pedaço que o motor de índices
  // calcula. Sem ele, a proposta sai sobre valor velho — no caso que serviu
  // de modelo, 20 meses de Selic a menos.

  let brutoAtualizado: number | null = null;

  if (fatorCorrecao === null) {
    linhas.push({
      id: 'correcao-periodo',
      rotulo: `Correção de ${mesAno(composicao.dataBase)} até ${mesAno(dataFinal)}`,
      valor: null,
      sinal: '+',
      origem: 'falta',
      detalhe: `série ${rotuloIndice(composicao.indice)} indisponível para o período`,
    });
    bloqueios.push({
      campo: 'fatorCorrecao',
      mensagem: `Não foi possível corrigir de ${mesAno(composicao.dataBase)} até ${mesAno(dataFinal)}: a série ${rotuloIndice(composicao.indice)} não cobre todo o intervalo. Sincronize os índices antes de precificar.`,
      impedeTotal: true,
    });
  } else {
    const valorCorrecao = round2(brutoDataBase * fatorCorrecao - brutoDataBase);
    brutoAtualizado = round2(brutoDataBase * fatorCorrecao);

    linhas.push({
      id: 'correcao-periodo',
      rotulo: `Correção de ${mesAno(composicao.dataBase)} até ${mesAno(dataFinal)}`,
      valor: valorCorrecao,
      sinal: '+',
      origem: 'calculado',
      detalhe: `${rotuloIndice(composicao.indice)}, fator ${fatorCorrecao.toFixed(6)}`,
    });

    linhas.push({
      id: 'bruto-atualizado',
      rotulo: `Bruto atualizado em ${mesAno(dataFinal)}`,
      valor: brutoAtualizado,
      sinal: '=',
      origem: 'calculado',
      destaque: true,
    });
  }

  // ---- Deduções ----
  //
  // Cada uma sai do valor do credor. Honorários sucumbenciais NÃO entram
  // aqui: no ofício eles são beneficiário próprio e recebem direto do ente.

  let acumulado = brutoAtualizado;
  const descontar = (valor: number | null) => {
    if (acumulado !== null && valor !== null) acumulado = round2(acumulado - valor);
  };

  // PSS: o ofício entrega o valor pronto, apurado sobre o principal.
  if (!deducoes.pssIncide) {
    linhas.push({
      id: 'pss',
      rotulo: 'Previdência (PSS)',
      valor: 0,
      sinal: '−',
      origem: 'oficio',
      detalhe: 'ofício informa que não incide',
      norma: NORMA_PSS,
    });
  } else if (deducoes.pssValor === null) {
    linhas.push({
      id: 'pss',
      rotulo: 'Previdência (PSS)',
      valor: null,
      sinal: '−',
      origem: 'falta',
      detalhe: 'ofício indica incidência mas o valor não foi informado',
      norma: NORMA_PSS,
    });
    bloqueios.push({
      campo: 'pssValor',
      mensagem:
        'O ofício diz que incide Previdência Social mas o valor não foi preenchido. Ele aparece no bloco do beneficiário, como "Valor da Previdência Social".',
      impedeTotal: true,
    });
  } else {
    const pct =
      composicao.principal > 0
        ? ((deducoes.pssValor / composicao.principal) * 100).toFixed(1)
        : null;
    linhas.push({
      id: 'pss',
      rotulo: 'Previdência (PSS)',
      valor: deducoes.pssValor,
      sinal: '−',
      origem: 'oficio',
      detalhe: pct ? `${pct}% sobre o principal` : undefined,
      norma: NORMA_PSS,
    });
    descontar(deducoes.pssValor);
  }

  // Honorários contratuais: saem do credor, por contrato com o advogado.
  const honorariosValor =
    deducoes.honorariosContratuaisValor ??
    (deducoes.honorariosContratuaisPct !== null && brutoAtualizado !== null
      ? round2((brutoAtualizado * deducoes.honorariosContratuaisPct) / 100)
      : null);

  if (honorariosValor !== null) {
    linhas.push({
      id: 'honorarios-contratuais',
      rotulo: 'Honorários contratuais',
      valor: honorariosValor,
      sinal: '−',
      origem: deducoes.honorariosContratuaisValor !== null ? 'digitado' : 'calculado',
      detalhe:
        deducoes.honorariosContratuaisValor === null && deducoes.honorariosContratuaisPct !== null
          ? `${deducoes.honorariosContratuaisPct}% sobre o bruto atualizado`
          : undefined,
    });
    descontar(honorariosValor);
  }

  // Gravames: reduzem o que está disponível pra cessão.
  const gravames: { id: string; rotulo: string; valor: number | null; campo: string }[] = [
    {
      id: 'cessao-anterior',
      rotulo: 'Cessão anterior averbada',
      valor: deducoes.cessaoAnterior,
      campo: 'cessaoAnterior',
    },
    { id: 'penhora', rotulo: 'Penhora / bloqueio', valor: deducoes.penhora, campo: 'penhora' },
    {
      id: 'compensacao',
      rotulo: 'Compensação tributária',
      valor: deducoes.compensacaoTributaria,
      campo: 'compensacaoTributaria',
    },
  ];

  for (const g of gravames) {
    if (g.valor === null || g.valor === 0) continue;
    linhas.push({
      id: g.id,
      rotulo: g.rotulo,
      valor: g.valor,
      sinal: '−',
      origem: 'digitado',
      norma: g.id === 'cessao-anterior' ? NORMA_CESSAO : undefined,
    });
    descontar(g.valor);
  }

  // ---- Imposto de renda ----
  //
  // Fica como pendência explícita nesta versão. A base de incidência depende
  // de teses que variam por tribunal (juros de mora em verba alimentar, Tema
  // 808 do STF), e um IR errado move o líquido em dezenas de milhares. Melhor
  // a tela dizer que falta do que entregar número que ninguém conferiu.

  if (tributacao.rraAtivo) {
    linhas.push({
      id: 'ir',
      rotulo: 'Imposto de renda',
      valor: null,
      sinal: '−',
      origem: 'falta',
      detalhe: tributacao.rraMeses
        ? `RRA de ${tributacao.rraMeses} meses — cálculo a implementar`
        : 'RRA sem número de meses informado',
      norma: NORMA_RRA,
    });
    bloqueios.push({
      campo: 'ir',
      mensagem:
        'O ofício indica Rendimentos Recebidos Acumuladamente. O cálculo do IR sobre RRA ainda não está implementado — o líquido abaixo está antes do imposto.',
      impedeTotal: false,
    });
  } else {
    linhas.push({
      id: 'ir',
      rotulo: 'Imposto de renda',
      valor: 0,
      sinal: '−',
      origem: 'oficio',
      detalhe: 'ofício não indica RRA',
      norma: NORMA_RRA,
    });
  }

  const provisorio = bloqueios.some((b) => !b.impedeTotal);
  const impedido = bloqueios.some((b) => b.impedeTotal);
  const liquidoDisponivel = impedido ? null : acumulado;

  linhas.push({
    id: 'liquido',
    rotulo: provisorio ? 'Líquido disponível (antes do IR)' : 'Líquido disponível',
    valor: liquidoDisponivel,
    sinal: '=',
    origem: liquidoDisponivel === null ? 'falta' : 'calculado',
    detalhe: 'base sobre a qual incide o deságio',
    norma: NORMA_CESSAO,
    destaque: true,
  });

  return { linhas, brutoAtualizado, liquidoDisponivel, provisorio, bloqueios };
}
