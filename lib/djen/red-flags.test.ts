import { describe, expect, it } from 'vitest';
import {
  REDFLAG_4E_EXTINCAO_CITADA,
  REDFLAG_4_QUITACAO_ARQUIVAMENTO,
  TODAS_REDFLAGS,
  detectarRedFlags,
  extrairFatos,
  infoRedFlag,
  nomeEstaMascarado,
  ordenarFlagsParaExibir,
  sanitizarTexto,
  temAlertaGrave,
} from './red-flags';

const codigos = (texto: string) => detectarRedFlags(texto).map((f) => f.codigo);

/**
 * Formato real da sentença padrão do TRT19 depois da expedição do precatório
 * (nomes e ID fictícios). Era a origem dos 16 falsos positivos da flag 4.
 */
const SENTENCA_PADRAO_TRT19 =
  'EXEQUENTE: JOANA EXEMPLO DA SILVA EXECUTADO: ESTADO DE ALAGOAS INTIMAÇÃO Fica V. Sa. ' +
  'intimado para tomar ciência da Sentença ID 0a1b2c3 proferida nos autos, cujo dispositivo ' +
  'consta a seguir: III - CONCLUSÃO Ante o exposto, declara-se a EXTINÇÃO DA EXECUÇÃO, na ' +
  'forma dos incisos dos Arts. 924 e 925 do CPC c/c Art. 769 da CLT, ressalvados erros ' +
  'materiais. Permaneçam os autos sobrestados, aguardando a disponibilização dos valores ' +
  'requisitados. Intimem-se. FULANO JUIZ FICTICIO Juiz do Trabalho Titular';

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

  it('trânsito certificado conta', () => {
    const casos = [
      'Certifico o trânsito em julgado da sentença em 10/03/2025.',
      'Ocorrido o trânsito em julgado, intime-se o exequente.',
      'sentença transitada em julgado em 12/02/2025',
      'Juntada a certidão de trânsito em julgado.',
    ];
    for (const texto of casos) {
      expect(
        detectarRedFlags(texto).some((f) => f.codigo === '9'),
        texto,
      ).toBe(true);
    }
  });

  it('trânsito que ainda vai acontecer não conta', () => {
    // As duas primeiras são as publicações reais do TRT19 0000952-62.2024.5.19.0008,
    // que ganhavam selo de trânsito sem ter transitado (RGT-95).
    const casos = [
      'determinando a remessa dos autos à Justiça Comum Estadual para apreciação da lide, após o trânsito em julgado, em arquivo no formato PDF',
      'para condenar o reclamado a pagar ao espólio, após o trânsito em julgado da sentença, já acrescido de juros',
      'Com o trânsito em julgado, arquivem-se os autos.',
      'Aguarde-se o trânsito em julgado.',
      'suspenso até o trânsito em julgado da ação coletiva',
      'depois do trânsito em julgado, expeça-se o ofício',
    ];
    for (const texto of casos) {
      expect(
        detectarRedFlags(texto).some((f) => f.codigo === '9'),
        texto,
      ).toBe(false);
    }
  });

  it('sentença padrão do TRT19 (extinção aguardando valores requisitados) é 4e, não 4', () => {
    const c = codigos(SENTENCA_PADRAO_TRT19);
    expect(c).toContain('4e');
    expect(c).not.toContain('4');
  });

  it('"conclusos para extinção da execução" é 4e, não 4', () => {
    const casos = [
      'certifique-se a inexistência de numerário em conta judicial e façam-se os autos conclusos para extinção da execução, nos termos do art. 925, do CPC.',
      // Prescrição intercorrente: extingue SEM pagamento — por isso o aviso não some
      'Decorrido o prazo prescricional intercorrente, voltem-me os autos conclusos para sentença de extinção da execução.',
      'Agravo de petição interposto contra decisão que julgou improcedente a extinção do cumprimento de sentença.',
      'procedendo, em seguida, ao arquivamento dos autos. Sem custas processuais.',
      // TRT19 chama de "obrigação satisfeita" a EXPEDIÇÃO do precatório, não o pagamento
      'SENTENÇA Com a expedição do precatório a obrigação foi satisfeita, nos termos do art. 924, II, CPC. Julgo extinta a execução. Intimem-se as partes. Transitada em julgado, determino o seguinte: 1. Sobreste-se o feito enquanto se aguarda o pagamento do precatório.',
      'aguarde-se informação da SEPREC quanto ao pagamento, devendo ser extinta a execução, ficando os autos sobrestados até o pagamento do referido PRECATÓRIO.',
    ];
    for (const texto of casos) {
      const c = codigos(texto);
      expect(c, texto).toContain('4e');
      expect(c, texto).not.toContain('4');
    }
  });

  it('4e é aviso amarelo, não bloqueador', () => {
    const f = detectarRedFlags(SENTENCA_PADRAO_TRT19).find((x) => x.codigo === '4e');
    expect(f?.cor).toBe('amarelo');
    expect(f?.categoria).toBe('NAVEGACIONAL');
  });

  it('sinal forte de pagamento continua 4', () => {
    const casos = [
      'Dou por extinta a execução pelo pagamento integral do crédito.',
      'declara-se a EXTINÇÃO DA EXECUÇÃO pelo pagamento, nos termos do art. 924, II, do CPC.',
      'Requer a extinção pelo pagamento.',
      'Julgo extinta a execução, em razão da quitação do crédito.',
      'Considerando o pagamento integral efetuado, arquivem-se os autos definitivamente.',
      'O precatório foi integralmente quitado conforme extrato.',
      'Determino o arquivamento definitivo do feito.',
    ];
    for (const texto of casos) {
      expect(codigos(texto), texto).toContain('4');
    }
  });

  it('com sinal forte no mesmo trecho, a 4e não duplica o aviso', () => {
    // "Dou por extinta a execução" casa 4e ("extinta a execução"), mas o
    // excludeIf vê o "Dou por extint" vizinho e deixa só a 4.
    expect(codigos('Dou por extinta a execução. Sem custas.')).not.toContain('4e');
    expect(codigos('Dou por extinta a execução pelo pagamento integral do crédito.')).not.toContain(
      '4e',
    );
  });

  it('quitação/pagamento que ainda vai acontecer não é 4', () => {
    const casos = [
      // Texto real do TRT19 (despacho pós-autuação do precatório)
      'Validado e autuado, mantenham-se os autos sobrestados até a quitação integral do precatório, nos termos do art. 2º.',
      'Aguardando o pagamento integral do crédito.',
      'expeça-se o Precatório para quitação do débito, intimando a parte credora.',
      'Com o trânsito em julgado, arquivem-se os autos.',
    ];
    for (const texto of casos) {
      expect(codigos(texto), texto).not.toContain('4');
    }
  });

  it('4e vem logo depois da 4 no catálogo', () => {
    const i = TODAS_REDFLAGS.indexOf(REDFLAG_4_QUITACAO_ARQUIVAMENTO);
    expect(TODAS_REDFLAGS[i + 1]).toBe(REDFLAG_4E_EXTINCAO_CITADA);
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

describe('infoRedFlag', () => {
  it('descrições humanas de 4 e 4e', () => {
    expect(infoRedFlag('4').descricaoHumana).toBe(
      'O texto fala em quitação, pagamento integral ou arquivamento definitivo. Confira se já foi pago.',
    );
    const i4e = infoRedFlag('4e');
    expect(i4e.cor).toBe('amarelo');
    expect(i4e.descricaoHumana).toContain('Leia a publicação antes de ligar.');
  });
});

describe('temAlertaGrave', () => {
  it('só cessão, FIDC, percentual em cessão, quitação e penhora são graves', () => {
    expect(temAlertaGrave(['X1', '9'])).toBe(false);
    expect(temAlertaGrave(['X1', '4'])).toBe(true);
    expect(temAlertaGrave(['X1', '4e'])).toBe(false);
    // X7 é vermelho no catálogo, mas é boilerplate do art. 100 §14 CF
    expect(temAlertaGrave(['X7'])).toBe(false);
    expect(temAlertaGrave(['zz9'])).toBe(false);
    expect(temAlertaGrave([])).toBe(false);
    for (const c of ['1', '1a', '1b', '1c', '2', '3a', '4', '8']) {
      expect(temAlertaGrave([c]), c).toBe(true);
    }
  });
});

describe('ordenarFlagsParaExibir', () => {
  it('grave, depois X1, depois amarelo, depois o resto — estável dentro do peso', () => {
    const entrada = ['10', 'X4', '5', '9', 'X1', '1c'];
    const saida = ordenarFlagsParaExibir(entrada);
    expect(saida.slice(0, 2)).toEqual(['1c', 'X1']);
    // amarelos (10, 5) antes dos cinza (X4, 9), cada grupo na ordem de entrada
    expect(saida).toEqual(['1c', 'X1', '10', '5', 'X4', '9']);
  });

  it('não muta a entrada', () => {
    const entrada = ['9', '4', 'X1'];
    ordenarFlagsParaExibir(entrada);
    expect(entrada).toEqual(['9', '4', 'X1']);
  });

  it('3a (amarelo no catálogo) sobe como grave; X7, 4e e desconhecido não', () => {
    expect(ordenarFlagsParaExibir(['X7', 'zz9', '4e', '3a'])).toEqual(['3a', '4e', 'X7', 'zz9']);
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
