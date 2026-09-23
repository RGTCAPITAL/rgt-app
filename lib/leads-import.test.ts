import { describe, expect, it } from 'vitest';
import {
  chaveDedup,
  cnjValido,
  normalizarTexto,
  parseDinheiroBR,
  parsePlanilha,
  resolverCampo,
  rotuloColuna,
} from './leads-import';

describe('normalizarTexto', () => {
  it('tira acento e baixa a caixa', () => {
    expect(normalizarTexto('Nome Completo')).toBe('nome_completo');
    expect(normalizarTexto('E-mail')).toBe('e_mail');
    expect(normalizarTexto('Observações')).toBe('observacoes');
  });

  it('colapsa pontuação e espaços repetidos', () => {
    expect(normalizarTexto('Nº  do   Processo')).toBe('n_do_processo');
    expect(normalizarTexto('  CPF/CNPJ  ')).toBe('cpf_cnpj');
  });
});

describe('resolverCampo', () => {
  it('reconhece os cabeçalhos da planilha do Renato', () => {
    expect(resolverCampo('Nome Completo')).toBe('nome');
    expect(resolverCampo('Número do Processo')).toBe('numero_processo');
    expect(resolverCampo('Telefone')).toBe('telefone');
    expect(resolverCampo('E-mail')).toBe('email');
    expect(resolverCampo('Valor do Processo')).toBe('valor_processo');
    expect(resolverCampo('Eventual Proposta')).toBe('valor_proposta_indicativa');
  });

  it('remove conectores pra casar variações', () => {
    expect(resolverCampo('Nº do Processo')).toBe('numero_processo');
    expect(resolverCampo('Valor da Causa')).toBe('valor_processo');
    expect(resolverCampo('Valor da Proposta')).toBe('valor_proposta_indicativa');
  });

  it('aceita sinônimos de nome usados em planilha de tribunal', () => {
    expect(resolverCampo('Credor')).toBe('nome');
    expect(resolverCampo('Exequente')).toBe('nome');
    expect(resolverCampo('Parte')).toBe('nome');
  });

  it('devolve null pra coluna desconhecida', () => {
    expect(resolverCampo('Vara de Origem')).toBeNull();
    expect(resolverCampo('')).toBeNull();
  });
});

describe('parseDinheiroBR', () => {
  it('lê moeda brasileira com milhar e decimal', () => {
    // O bug que motivou a função: parseFloat devolveria 187.43
    expect(parseDinheiroBR('R$ 187.430,00')).toBe(187430);
    expect(parseDinheiroBR('1.234.567,89')).toBe(1234567.89);
  });

  it('lê só com vírgula decimal', () => {
    expect(parseDinheiroBR('187430,00')).toBe(187430);
    expect(parseDinheiroBR('1500,5')).toBe(1500.5);
  });

  it('trata ponto sozinho como milhar quando o grupo tem 3 dígitos', () => {
    expect(parseDinheiroBR('187.430')).toBe(187430);
    expect(parseDinheiroBR('1.234.567')).toBe(1234567);
  });

  it('trata ponto sozinho como decimal quando não são 3 dígitos', () => {
    // Célula que já veio em formato americano do próprio Excel
    expect(parseDinheiroBR('187.43')).toBe(187.43);
    expect(parseDinheiroBR('0.5')).toBe(0.5);
  });

  it('aceita number direto (célula formatada como moeda)', () => {
    expect(parseDinheiroBR(187430)).toBe(187430);
    expect(parseDinheiroBR(0)).toBe(0);
  });

  it('rejeita negativo, texto e vazio', () => {
    expect(parseDinheiroBR('-100')).toBeNull();
    expect(parseDinheiroBR('(100)')).toBeNull();
    expect(parseDinheiroBR('a combinar')).toBeNull();
    expect(parseDinheiroBR('')).toBeNull();
    expect(parseDinheiroBR(null)).toBeNull();
    expect(parseDinheiroBR(undefined)).toBeNull();
  });

  it('arredonda pra 2 casas', () => {
    expect(parseDinheiroBR('10,999')).toBe(11);
    expect(parseDinheiroBR(10.994)).toBe(10.99);
  });
});

describe('cnjValido', () => {
  it('aceita CNJ real da base do TRT19', () => {
    expect(cnjValido('0001107-33.2017.5.19.0001')).toBe(true);
    expect(cnjValido('0001350-96.2025.5.19.0000')).toBe(true);
  });

  it('aceita sem máscara', () => {
    expect(cnjValido('00004382920215190004')).toBe(true);
  });

  it('rejeita dígito verificador errado', () => {
    // Mesmo processo, DD trocado de 33 pra 99
    expect(cnjValido('0001107-99.2017.5.19.0001')).toBe(false);
  });

  it('rejeita tamanho errado', () => {
    expect(cnjValido('123')).toBe(false);
    expect(cnjValido('')).toBe(false);
    expect(cnjValido('000110733201751900011')).toBe(false);
  });
});

describe('parsePlanilha', () => {
  const PLANILHA_RENATO = [
    [
      'Nome Completo',
      'Número do Processo',
      'Telefone',
      'E-mail',
      'Valor do Processo',
      'Eventual Proposta',
    ],
    [
      'José Ribamar',
      '0001107-33.2017.5.19.0001',
      '82999998888',
      'jose@ex.com',
      'R$ 187.430,00',
      'R$ 120.000,00',
    ],
    ['Maria Santos', '0001350-96.2025.5.19.0000', '82988887777', '', '50000', ''],
  ];

  it('lê a planilha do Renato com todos os campos', () => {
    const r = parsePlanilha(PLANILHA_RENATO);
    expect(r.erro).toBeNull();
    expect(r.linhas).toHaveLength(2);
    expect(r.linhas[0]).toMatchObject({
      nome: 'José Ribamar',
      numero_processo: '0001107-33.2017.5.19.0001',
      telefone: '82999998888',
      valor_processo: 'R$ 187.430,00',
      valor_proposta_indicativa: 'R$ 120.000,00',
    });
    expect(r.camposDetectados).toContain('valor_processo');
  });

  it('encontra cabeçalho fora da primeira linha', () => {
    const comTitulo = [
      ['RELAÇÃO DE CREDORES — SETEMBRO'],
      [],
      ['Nome', 'Telefone'],
      ['João', '82911112222'],
    ];
    const r = parsePlanilha(comTitulo);
    expect(r.erro).toBeNull();
    expect(r.linhas).toEqual([{ nome: 'João', telefone: '82911112222', linhaOrigem: 4 }]);
  });

  it('reporta colunas ignoradas em vez de descartar em silêncio', () => {
    const r = parsePlanilha([
      ['Nome', 'Vara de Origem', 'Telefone', 'Situação'],
      ['João', '1ª Vara', '82911112222', 'ativo'],
    ]);
    expect(r.colunasIgnoradas).toEqual(['Vara de Origem', 'Situação']);
  });

  it('erra com mensagem útil quando não acha coluna de nome', () => {
    const r = parsePlanilha([
      ['Telefone', 'Valor'],
      ['82911112222', '100'],
    ]);
    expect(r.erro).toContain('Nenhuma coluna de nome');
    expect(r.erro).toContain('Telefone');
  });

  it('pula linhas totalmente vazias', () => {
    const r = parsePlanilha([['Nome', 'Telefone'], ['João', '82911112222'], [], ['', '']]);
    expect(r.linhas).toHaveLength(1);
  });

  it('devolve erro pra planilha vazia', () => {
    expect(parsePlanilha([]).erro).toBe('Planilha vazia.');
  });
});

describe('chaveDedup', () => {
  it('prefere CPF quando existe', () => {
    expect(chaveDedup({ cpf_cnpj: '123.456.789-01', telefone: '82999998888' })).toBe(
      'cpf:12345678901',
    );
  });

  it('usa CNJ e telefone juntos, nunca CNJ sozinho', () => {
    // Litisconsórcio: duas pessoas no mesmo processo são leads diferentes
    const a = chaveDedup({ numero_processo: '00011073320175190001', telefone: '82999998888' });
    const b = chaveDedup({ numero_processo: '00011073320175190001', telefone: '82911112222' });
    expect(a).not.toBe(b);
  });

  it('normaliza máscara antes de comparar', () => {
    const comMascara = chaveDedup({
      numero_processo: '0001107-33.2017.5.19.0001',
      telefone: '(82) 99999-8888',
    });
    const semMascara = chaveDedup({
      numero_processo: '00011073320175190001',
      telefone: '82999998888',
    });
    expect(comMascara).toBe(semMascara);
  });

  it('cai pra telefone sozinho quando não tem processo', () => {
    expect(chaveDedup({ telefone: '82999998888' })).toBe('tel:82999998888');
  });

  it('devolve null quando não há nada comparável', () => {
    expect(chaveDedup({ nome: 'João' } as never)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regressão dos defeitos achados no review adversarial de 2026-09-23.
// Cada um destes falhou na primeira versão do importador.
// ---------------------------------------------------------------------------

describe('regressão: célula numérica do Excel', () => {
  it('não multiplica por mil número com 3 casas decimais', () => {
    // Coluna de proposta quase sempre vem de fórmula (=valor*0,65). Se o
    // number for stringificado antes de parsear, "121810.727" cai na
    // heurística de milhar e vira R$ 121,8 milhões.
    const r = parsePlanilha([
      ['Nome', 'Eventual Proposta'],
      ['José Ribamar', 121810.727],
    ]);
    expect(typeof r.linhas[0]?.valor_proposta_indicativa).toBe('number');
    expect(parseDinheiroBR(r.linhas[0]?.valor_proposta_indicativa)).toBe(121810.73);
  });

  it('preserva o tipo number na saída do parse', () => {
    const r = parsePlanilha([
      ['Nome', 'Valor'],
      ['Maria', 187430.125],
    ]);
    expect(parseDinheiroBR(r.linhas[0]?.valor_processo)).toBe(187430.13);
  });
});

describe('regressão: detecção de cabeçalho', () => {
  it('ignora bloco de metadados no topo', () => {
    // 'Cliente' e 'Contato' são sinônimos válidos (nome e telefone), então a
    // linha de metadados empatava com o cabeçalho real e vencia por estar
    // antes — fazendo o cabeçalho real virar o primeiro lead.
    const r = parsePlanilha([
      ['RELATÓRIO DE CREDORES'],
      ['Cliente:', 'Prefeitura de Maceió'],
      ['Contato:', 'Dr. Fulano'],
      [],
      ['Nome Completo', 'Nº do Processo', 'Telefone', 'Valor'],
      ['José Ribamar', '0001107-33.2017.5.19.0001', '82999998888', '1000'],
    ]);
    expect(r.linhaCabecalho).toBe(5);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]?.nome).toBe('José Ribamar');
  });

  it('conta campos distintos, não células reconhecidas', () => {
    // ['Cliente','Credor'] são dois sinônimos do MESMO campo: vale 1, não 2
    const r = parsePlanilha([
      ['Cliente', 'Credor'],
      ['Nome', 'Telefone'],
      ['João', '82911112222'],
    ]);
    expect(r.linhaCabecalho).toBe(2);
  });
});

describe('regressão: colunas que sumiam em silêncio', () => {
  it('reporta duas colunas disputando o mesmo campo', () => {
    // "Contato" vira telefone e engolia a coluna "Telefone" real
    const r = parsePlanilha([
      ['Nome', 'Contato', 'Telefone'],
      ['José', 'falar com a filha Maria', '82999998888'],
    ]);
    expect(r.colunasDuplicadas).toHaveLength(1);
    expect(r.colunasDuplicadas[0]).toMatchObject({ campo: 'telefone', venceu: 'Contato' });
  });

  it('reporta coluna com dados mas sem título', () => {
    const r = parsePlanilha([
      ['Nome', '', 'Telefone'],
      ['José', 'R$ 187.430,00', '82999998888'],
    ]);
    expect(r.colunasSemCabecalho).toEqual(['B']);
  });

  it('não reclama de coluna sem título e sem dados', () => {
    const r = parsePlanilha([
      ['Nome', '', 'Telefone'],
      ['José', '', '82999998888'],
    ]);
    expect(r.colunasSemCabecalho).toEqual([]);
  });
});

describe('regressão: número da linha de origem', () => {
  it('aponta a linha real da planilha, não a posição no array', () => {
    // Com título e linha em branco antes, o primeiro dado está na linha 4.
    // A versão antiga usava indice+2 e dizia "linha 2" — que é a em branco.
    const r = parsePlanilha([
      ['RELAÇÃO DE CREDORES'],
      [],
      ['Nome', 'Telefone'],
      ['José', '82999998888'],
      ['Maria', '82988887777'],
    ]);
    expect(r.linhas[0]?.linhaOrigem).toBe(4);
    expect(r.linhas[1]?.linhaOrigem).toBe(5);
  });
});

describe('rotuloColuna', () => {
  it('numera como o Excel', () => {
    expect(rotuloColuna(0)).toBe('A');
    expect(rotuloColuna(25)).toBe('Z');
    expect(rotuloColuna(26)).toBe('AA');
    expect(rotuloColuna(27)).toBe('AB');
  });
});
