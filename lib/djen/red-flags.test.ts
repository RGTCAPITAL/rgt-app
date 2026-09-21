import { describe, expect, it } from 'vitest';
import { detectarRedFlags, extrairFatos, nomeEstaMascarado, sanitizarTexto } from './red-flags';

describe('nomeEstaMascarado', () => {
  it('reconhece iniciais separadas por ponto', () => {
    expect(nomeEstaMascarado('E.A.D.O.')).toBe(true);
    expect(nomeEstaMascarado('M.C.D.M.P.')).toBe(true);
    expect(nomeEstaMascarado('J. S. P.')).toBe(true);
  });

  it('recusa nome completo', () => {
    expect(nomeEstaMascarado('José da Silva')).toBe(false);
    expect(nomeEstaMascarado('MARIA DA CONCEIÇÃO')).toBe(false);
  });

  it('recusa 1 letra só', () => {
    // "J." isolado seria falso positivo — quer 2+ iniciais
    expect(nomeEstaMascarado('J.')).toBe(false);
  });
});

describe('detectarRedFlags', () => {
  it('acha cessão averbada BLOQUEADOR', () => {
    const texto = 'DEFIRO a substituição do cedente por FIDC PRECATÓRIOS BRASIL...';
    const flags = detectarRedFlags(texto);
    expect(flags.some((f) => f.codigo === '1')).toBe(true);
    // FIDC também bate na 2 — as duas contam, é sinal reforçado
    expect(flags.some((f) => f.codigo === '2')).toBe(true);
  });

  it('acha boilerplate TJAL literal', () => {
    const flags = detectarRedFlags(
      'considerando a habilitação do Fundo Cessionário no lugar da parte cedente...',
    );
    expect(flags.some((f) => f.codigo === '1a')).toBe(true);
  });

  it('extrai nome de credor cedente ("figura como cedente NOME")', () => {
    const texto = '... figura como cedente Carlos Eduardo Vasconcelos ...';
    const flags = detectarRedFlags(texto);
    expect(flags.some((f) => f.codigo === '1b')).toBe(true);
  });

  it('categoria BLOQUEADOR marca vermelho', () => {
    const flags = detectarRedFlags(
      'Dou por extinta a execução pelo pagamento integral do crédito.',
    );
    const bloq = flags.find((f) => f.codigo === '4');
    expect(bloq?.categoria).toBe('BLOQUEADOR');
    expect(bloq?.cor).toBe('vermelho');
  });

  it('exclui falso positivo de "20% dos honorários contratuais"', () => {
    // O padrão genérico "% do crédito" só dispara SEM contexto de honorários.
    // Precatório sadio tem 20% de honorários, isso não é sinal de cessão.
    const flags = detectarRedFlags(
      'Retenção de 20% do crédito a título de honorários contratuais.',
    );
    expect(flags.filter((f) => f.codigo === '3')).toHaveLength(0);
  });

  it('trecho e contexto ficam ao redor do match', () => {
    const texto = 'A tolerância acabou. Dou por extinta a execução. Sem custas.';
    const flags = detectarRedFlags(texto);
    const f = flags.find((x) => x.codigo === '4');
    expect(f?.trecho).toContain('Dou por extint');
    expect(f?.contexto).toContain('tolerância');
    expect(f?.contexto).toContain('Sem custas');
  });

  it('devolve vazio pra texto sem sinal', () => {
    expect(detectarRedFlags('')).toEqual([]);
    expect(detectarRedFlags('Manutenção da sentença.')).toEqual([]);
  });

  it('não loopa infinito com regex.g em match vazio', () => {
    // Sanidade: se algum regex casar string vazia (bug), a função pendura.
    expect(() => detectarRedFlags('a'.repeat(500))).not.toThrow();
  });
});

describe('extrairFatos', () => {
  it('extrai cessionário de "substituição do cedente por"', () => {
    const f = extrairFatos(
      'Defiro a substituição do cedente por Naples Securitizadora S.A. em razão de...',
    );
    expect(f.cessionario).toContain('Naples Securitizadora');
  });

  it('extrai deságio de contexto de cessão', () => {
    const f = extrairFatos('Termo de cessão correspondente a 50% do valor do crédito.');
    expect(f.desagioPercentual).toBe(50);
  });

  it('extrai ano LOA sensato', () => {
    expect(extrairFatos('Pago em 2027 conforme LOA').anoOrcamentario).toBe(2027);
    expect(extrairFatos('exercício de 2025').anoOrcamentario).toBe(2025);
  });

  it('rejeita ano fora da janela', () => {
    // "de 1998" não é LOA de precatório em produção
    expect(extrairFatos('processo de 1998').anoOrcamentario).toBeUndefined();
  });

  it('rejeita deságio > 100%', () => {
    const f = extrairFatos('cessão de 150% do valor');
    expect(f.desagioPercentual).toBeUndefined();
  });
});

describe('sanitizarTexto', () => {
  it('transforma <br> em quebra de linha', () => {
    expect(sanitizarTexto('linha 1<br>linha 2<br/>linha 3')).toBe('linha 1\nlinha 2\nlinha 3');
  });

  it('preserva o resto do texto', () => {
    expect(sanitizarTexto('texto simples')).toBe('texto simples');
  });
});
