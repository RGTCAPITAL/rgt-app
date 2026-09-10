/**
 * Decodifica o número CNJ.
 *
 * O padrão CNJ (Res. 65/2008) é NNNNNNN-DD.AAAA.J.TR.OOOO. Os campos `J`
 * (segmento do Judiciário) e `TR` (tribunal dentro do segmento) identificam o
 * tribunal de forma determinística — não precisa perguntar pra IA, e não dá
 * pra alucinar. Sempre que o número existir, ele ganha da leitura do PDF.
 *
 * O que NÃO dá pra derivar daqui é a **esfera do ente devedor**. Um precatório
 * trabalhista (segmento 5) pode ser devido por um município. Esfera sai do
 * `entes_devedores`, não do tribunal.
 */

/** Códigos de UF na ordem alfabética do nome do estado, conforme a Res. 65. */
const UF_POR_CODIGO: Record<string, string> = {
  '01': 'AC',
  '02': 'AL',
  '03': 'AP',
  '04': 'AM',
  '05': 'BA',
  '06': 'CE',
  '07': 'DF',
  '08': 'ES',
  '09': 'GO',
  '10': 'MA',
  '11': 'MT',
  '12': 'MS',
  '13': 'MG',
  '14': 'PA',
  '15': 'PB',
  '16': 'PR',
  '17': 'PE',
  '18': 'PI',
  '19': 'RJ',
  '20': 'RN',
  '21': 'RS',
  '22': 'RO',
  '23': 'RR',
  '24': 'SC',
  '25': 'SE',
  '26': 'SP',
  '27': 'TO',
};

export type CnjDecodificado = {
  digitos: string;
  ano: string;
  /** Sigla no formato usado em `lib/tribunais.ts`: TRT19, TJAL, TRF5, STJ… */
  siglaTribunal: string | null;
};

/**
 * Extrai só os dígitos e valida o comprimento. Retorna null pra qualquer coisa
 * que não seja um CNJ de 20 dígitos — inclusive CPF, que também é só número.
 */
export function digitosCnj(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, '');
  return d.length === 20 ? d : null;
}

export function decodificarCnj(v: string | null | undefined): CnjDecodificado | null {
  const d = digitosCnj(v);
  if (!d) return null;

  const ano = d.slice(9, 13);
  const segmento = d.slice(13, 14);
  const tr = d.slice(14, 16);

  return { digitos: d, ano, siglaTribunal: siglaDoSegmento(segmento, tr) };
}

function siglaDoSegmento(segmento: string, tr: string): string | null {
  const n = Number(tr);

  switch (segmento) {
    case '1': // Supremo
      return 'STF';
    case '3': // Superior Tribunal de Justiça
      return 'STJ';
    case '4': // Justiça Federal — TR é a região (1 a 6)
      return n >= 1 && n <= 6 ? `TRF${n}` : null;
    case '5': // Justiça do Trabalho — TR 00 é o TST, 1..24 são as regiões
      if (n === 0) return 'TST';
      return n >= 1 && n <= 24 ? `TRT${n}` : null;
    case '6': // Justiça Eleitoral — TR 00 é o TSE, demais são TREs por UF
      if (n === 0) return 'TSE';
      return UF_POR_CODIGO[tr] ? `TRE${UF_POR_CODIGO[tr]}` : null;
    case '7': // Justiça Militar da União
      return 'STM';
    case '8': // Justiça Estadual — TR é o código da UF
      return UF_POR_CODIGO[tr] ? `TJ${UF_POR_CODIGO[tr]}` : null;
    case '9': // Justiça Militar Estadual — só MG, RS e SP têm TJM próprio
      return UF_POR_CODIGO[tr] ? `TJM${UF_POR_CODIGO[tr]}` : null;
    default:
      // Segmento 2 é o CNJ (processos administrativos). Não vira operação.
      return null;
  }
}
