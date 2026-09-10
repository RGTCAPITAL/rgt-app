import { describe, expect, it } from 'vitest';
import {
  montarRevisao,
  parseData,
  parseLoa,
  parsePercentual,
  parseValor,
  resolverEnte,
  resolverTribunal,
  type EnteOpcao,
} from './resolver';
import type { ExtracaoOficio } from './schema';

const ENTES: EnteOpcao[] = [
  { id: 'e1', nome: 'Município de Maceió', esfera: 'municipal' },
  { id: 'e2', nome: 'Estado de Alagoas', esfera: 'estadual' },
  { id: 'e3', nome: 'União', esfera: 'federal' },
  { id: 'e4', nome: 'Município de Marechal Deodoro', esfera: 'municipal' },
];

/**
 * Monta a extração no formato de lista que a API devolve.
 *
 * `campos` aqui é um objeto só por conveniência de escrita nos testes — vira
 * lista antes de entrar no resolver, que é o que a IA produz de verdade.
 */
function extracao(
  campos: Record<string, string> = {},
  extra: Partial<Omit<ExtracaoOficio, 'campos'>> = {},
): ExtracaoOficio {
  return {
    documento_reconhecido: true,
    observacao: null,
    campos: Object.entries(campos).map(([campo, valor]) => ({
      campo,
      valor,
      confianca: 'alta' as const,
      trecho: `"${valor}"`,
    })),
    ...extra,
  };
}

describe('parseValor', () => {
  it('entende formato brasileiro com separador de milhar', () => {
    expect(parseValor('R$ 125.430,55')).toBe('125430.55');
  });

  it('entende o formato que pedimos no prompt', () => {
    expect(parseValor('125430.55')).toBe('125430.55');
  });

  it('não confunde ponto de milhar com decimal', () => {
    expect(parseValor('1.250.000,00')).toBe('1250000');
  });

  it('recusa texto e valor negativo', () => {
    expect(parseValor('não informado')).toBeNull();
    expect(parseValor('-500,00')).toBeNull();
    expect(parseValor(null)).toBeNull();
  });
});

describe('parseData', () => {
  it('aceita ISO e formato brasileiro', () => {
    expect(parseData('2024-03-15')).toBe('2024-03-15');
    expect(parseData('15/03/2024')).toBe('2024-03-15');
  });

  it('recusa data impossível e ano fora da janela', () => {
    expect(parseData('2024-13-01')).toBeNull();
    expect(parseData('1950-01-01')).toBeNull();
    expect(parseData('março de 2024')).toBeNull();
  });
});

describe('parseLoa e parsePercentual', () => {
  it('extrai o ano do orçamento mesmo com texto em volta', () => {
    expect(parseLoa('LOA 2027')).toBe('2027');
    expect(parseLoa('1998')).toBeNull();
  });

  it('recusa percentual acima de 100', () => {
    expect(parsePercentual('20')).toBe('20');
    expect(parsePercentual('150')).toBeNull();
  });
});

describe('resolverTribunal', () => {
  it('casa a sigla com o label completo do select', () => {
    expect(resolverTribunal('TRT19', 'federal')).toMatch(/^TRT19 - /);
    expect(resolverTribunal('TJAL', 'estadual')).toMatch(/^TJAL - /);
  });

  it('não devolve tribunal de outra esfera', () => {
    // O select é filtrado por esfera: devolver TRT19 numa operação estadual
    // resultaria num valor que a opção nem existe na lista.
    expect(resolverTribunal('TRT19', 'estadual')).toBeNull();
  });

  it('busca em todas as esferas quando a esfera é desconhecida', () => {
    expect(resolverTribunal('TRT19', null)).toMatch(/^TRT19 - /);
  });

  it('devolve null pra sigla inexistente', () => {
    expect(resolverTribunal('TRT99', null)).toBeNull();
    expect(resolverTribunal(null, 'federal')).toBeNull();
  });
});

describe('resolverEnte', () => {
  it('ignora prefixo e acento', () => {
    expect(resolverEnte('MUNICIPIO DE MACEIO', ENTES)?.id).toBe('e1');
    expect(resolverEnte('Prefeitura Municipal de Maceió', ENTES)?.id).toBe('e1');
  });

  it('casa pelo nome nu', () => {
    expect(resolverEnte('Maceió', ENTES)?.id).toBe('e1');
  });

  it('recusa casamento ambíguo', () => {
    // "Município de" bate com dois entes — escolher um seria colocar a operação
    // no devedor errado, que define índice de correção e ordem de pagamento.
    expect(resolverEnte('Município', ENTES)).toBeNull();
  });

  it('devolve null quando não existe no cadastro', () => {
    expect(resolverEnte('Município de Recife', ENTES)).toBeNull();
  });
});

describe('campo inventado pela IA', () => {
  it('ignora nome de campo que o resolver não conhece', () => {
    const r = montarRevisao(
      extracao({ cedente_nome: 'joão da silva', valor_do_imovel: '999', foo: 'bar' }),
      ENTES,
    );
    expect(r.campos.map((c) => c.id)).toEqual(['cedente_nome']);
  });

  it('fica com a primeira ocorrência quando o campo vem repetido', () => {
    const r = montarRevisao(
      {
        documento_reconhecido: true,
        observacao: null,
        campos: [
          { campo: 'loa', valor: '2027', confianca: 'alta', trecho: 'LOA 2027' },
          { campo: 'loa', valor: '2030', confianca: 'baixa', trecho: 'outra menção' },
        ],
      },
      ENTES,
    );
    expect(r.campos.find((c) => c.id === 'loa')?.patch.loa).toBe('2027');
  });
});

describe('montarRevisao', () => {
  it('deriva o tribunal do CNJ, ignorando a sigla lida pela IA', () => {
    const r = montarRevisao(
      extracao({
        numero_processo: '0001107-33.2017.5.19.0001',
        tribunal_sigla: 'TJAL', // leitura errada de propósito
        ente_devedor: 'União',
      }),
      ENTES,
    );
    const tribunal = r.campos.find((c) => c.id === 'tribunal');
    expect(tribunal?.patch.tribunal).toMatch(/^TRT19 - /);
    expect(tribunal?.confianca).toBe('alta');
  });

  it('traz a esfera junto com o ente devedor', () => {
    const r = montarRevisao(extracao({ ente_devedor: 'Município de Maceió' }), ENTES);
    const ente = r.campos.find((c) => c.id === 'ente_devedor_id');
    expect(ente?.patch).toEqual({ esfera: 'municipal', ente_devedor_id: 'e1' });
  });

  it('liga o toggle junto com o percentual de PSS', () => {
    const r = montarRevisao(extracao({ pss_pct: '11' }), ENTES);
    const pss = r.campos.find((c) => c.id === 'pss_pct');
    expect(pss?.patch).toEqual({ pss_ativo: true, pss_pct: '11' });
    expect(pss?.monetario).toBe(true);
  });

  it('descarta campo que não sobrevive ao parse em vez de aplicar lixo', () => {
    const r = montarRevisao(
      extracao({
        cedente_cpf: '123', // CPF incompleto
        valor_principal: 'a combinar',
        data_base: 'em breve',
      }),
      ENTES,
    );
    expect(r.campos.map((c) => c.id)).not.toContain('cedente_cpf');
    expect(r.campos.map((c) => c.id)).not.toContain('valor_principal');
    expect(r.campos.map((c) => c.id)).not.toContain('data_base');
  });

  it('avisa quando o ente lido não existe no cadastro', () => {
    const r = montarRevisao(extracao({ ente_devedor: 'Município de Recife' }), ENTES);
    expect(r.campos.find((c) => c.id === 'ente_devedor_id')).toBeUndefined();
    expect(r.avisos.join(' ')).toContain('Recife');
  });

  it('avisa quando o tribunal não cabe na esfera do ente', () => {
    // Precatório trabalhista devido por município: existe no mundo real, mas o
    // select de tribunal do app é filtrado por esfera e não tem TRT no municipal.
    const r = montarRevisao(
      extracao({
        numero_processo: '0001107-33.2017.5.19.0001',
        ente_devedor: 'Município de Maceió',
      }),
      ENTES,
    );
    expect(r.campos.find((c) => c.id === 'tribunal')).toBeUndefined();
    expect(r.avisos.join(' ')).toContain('TRT19');
  });

  it('coloca o ente antes do tribunal para aplicar um a um não se perder', () => {
    const r = montarRevisao(
      extracao({
        numero_processo: '1000000-00.2020.8.02.0001',
        ente_devedor: 'Estado de Alagoas',
      }),
      ENTES,
    );
    const ids = r.campos.map((c) => c.id);
    expect(ids.indexOf('ente_devedor_id')).toBeLessThan(ids.indexOf('tribunal'));
  });

  it('separa monetário de não-monetário', () => {
    const r = montarRevisao(
      extracao({
        cedente_nome: 'joão da silva',
        valor_principal: '125430.55',
      }),
      ENTES,
    );
    expect(r.campos.find((c) => c.id === 'cedente_nome')?.monetario).toBe(false);
    // titleCase é aplicado: o banco guarda nome normalizado.
    expect(r.campos.find((c) => c.id === 'cedente_nome')?.patch.cedente_nome).toBe('João da Silva');
    expect(r.campos.find((c) => c.id === 'valor_principal')?.monetario).toBe(true);
  });

  it('propaga documento não reconhecido', () => {
    const r = montarRevisao(extracao({}, { documento_reconhecido: false }), ENTES);
    expect(r.documentoReconhecido).toBe(false);
  });

  it('só aceita enum que existe na constante do formulário', () => {
    const r = montarRevisao(extracao({ tipo: 'precatório', natureza: 'trabalhista' }), ENTES);
    expect(r.campos.find((c) => c.id === 'tipo')?.patch.tipo).toBe('precatorio');
    // "trabalhista" não é uma natureza válida no cadastro — vira nada.
    expect(r.campos.find((c) => c.id === 'natureza')).toBeUndefined();
  });
});
