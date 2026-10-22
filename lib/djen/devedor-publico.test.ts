import { describe, expect, it } from 'vitest';
import {
  classeDominante,
  classificarDevedor,
  devedoresProvaveis,
  normalizarNome,
} from './devedor-publico';

/**
 * Os casos abaixo não são inventados: são nomes de parte colhidos na varredura
 * real da RGT-95 (TRT19, TJAL e TRF5, em 2026-10-22), quando o Renato mandou
 * três nomes por WhatsApp pedindo pra achar os processos. É o conjunto que
 * mostra por que a triagem por devedor existe — dos 9 processos de uma das
 * pessoas, nenhum podia virar precatório.
 */

describe('classificarDevedor — partes reais do levantamento', () => {
  it('reconhece o Estado de Alagoas, que é o único prospect real do lote', () => {
    const r = classificarDevedor('ESTADO DE ALAGOAS');
    expect(r.classe).toBe('estadual');
    expect(r.comprado).toBe(true);
  });

  it('reconhece a União como o TRT19 escreve', () => {
    // No DJEN vem assim, com o órgão entre parênteses.
    const r = classificarDevedor('UNIÃO FEDERAL (AGU)');
    expect(r.classe).toBe('federal');
    expect(r.comprado).toBe(true);
  });

  it.each([
    'RESTAURANTE CASA DA PRAIA LTDA',
    'BITTENCOURT & CIA LTDA',
    'FEIJOADA DA GALEGA LTDA',
    'CLINICA DRA CARINA LISA LTDA',
    'CHAMA  -  COMPLEXO HOSPITALAR MANOEL ANDRE LTDA',
  ])('trata empresa privada como privado: %s', (nome) => {
    const r = classificarDevedor(nome);
    expect(r.classe).toBe('privado');
    expect(r.comprado).toBe(false);
  });

  it.each(['ARNALDO ALVES PINA FERREIRA', 'MARIA APARECIDA ALMEIDA SANTOS', 'CARINA ISABEL LISA'])(
    'trata pessoa física como privado: %s',
    (nome) => {
      expect(classificarDevedor(nome).classe).toBe('privado');
    },
  );

  it.each(['BANCO BRADESCO FINANCIAMENTOS SA', 'BANCO PAN SA', 'BANCO BMG S/A', 'BRASKEM S.A'])(
    'banco e empresa de capital aberto não viram prospect: %s',
    (nome) => {
      expect(classificarDevedor(nome).comprado).toBe(false);
    },
  );
});

describe('classificarDevedor — as armadilhas', () => {
  it('"União dos Palmares" é município de Alagoas, não a União', () => {
    // Apareceu no levantamento como "Vara do Trabalho de União dos Palmares".
    // Sem o lookahead, cairia em federal e viraria prospect falso.
    expect(classificarDevedor('MUNICIPIO DE UNIÃO DOS PALMARES').classe).toBe('municipal');
    expect(classificarDevedor('UNIÃO DOS PALMARES').classe).not.toBe('federal');
  });

  it('"Município de União" (PI) é municipal, apesar da palavra União', () => {
    // Marcador municipal roda antes das regras federais justamente por isto.
    expect(classificarDevedor('MUNICIPIO DE UNIÃO').classe).toBe('municipal');
  });

  it('municipal é detectado mas NÃO é comprado hoje', () => {
    // A esfera municipal está bloqueada no banco (trigger check_esfera_municipal).
    // Detectar e marcar como não-comprável é diferente de não detectar.
    const r = classificarDevedor('MUNICIPIO DE MACEIÓ');
    expect(r.classe).toBe('municipal');
    expect(r.comprado).toBe(false);
  });

  it('estatal não gera precatório — Banco do Brasil não é fazenda pública', () => {
    const r = classificarDevedor('BANCO DO BRASIL S.A');
    expect(r.classe).toBe('estatal');
    expect(r.comprado).toBe(false);
  });

  it('Correios é a exceção: estatal equiparada a fazenda pública', () => {
    // RE 220.906. Sem esta regra, um precatório real da ECT seria descartado.
    const r = classificarDevedor('EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS');
    expect(r.classe).toBe('federal');
    expect(r.comprado).toBe(true);
  });

  it('acento e caixa não mudam a classificação', () => {
    // Os autos divergem entre si: o mesmo processo da Waldiria traz
    // "SIRQUEIRA" na 1ª instância e "SIQUEIRA" na 2ª.
    expect(classificarDevedor('estado de alagoas').classe).toBe('estadual');
    expect(classificarDevedor('Município de Maceió').classe).toBe('municipal');
    expect(normalizarNome('  José   da Silva ')).toBe('JOSE DA SILVA');
  });

  it('autarquia federal pelo conselho profissional', () => {
    expect(classificarDevedor('CONSELHO REGIONAL DE ENFERMAGEM DE ALAGOAS').classe).toBe('federal');
  });

  it('entes do master entes_devedores também casam pela heurística', () => {
    // Os dois exemplos que existem na tabela hoje.
    expect(classificarDevedor('Defensoria Pública do Estado de Alagoas (DPE-AL)').classe).toBe(
      'estadual',
    );
    expect(classificarDevedor('Agência Nacional de Energia Elétrica (ANEEL)').classe).toBe(
      'federal',
    );
  });
});

describe('devedoresProvaveis', () => {
  const P = (nome: string, polo: 'A' | 'P' | 'T') => ({ nome, polo });

  it('exclui a pessoa buscada e classifica o resto', () => {
    const r = devedoresProvaveis(
      [P('WALDIRIA MARIA SIQUEIRA AYRES', 'A'), P('ESTADO DE ALAGOAS', 'P')],
      'Waldiria Maria Siqueira Ayres',
    );
    expect(r).toHaveLength(1);
    expect(r[0].classe).toBe('estadual');
  });

  it('casa a pessoa buscada por prefixo, porque o nome dos autos é mais longo', () => {
    // Renato buscou "Maria Sofia de Oliveira"; nos autos é "...OLIVEIRA SANTOS".
    const r = devedoresProvaveis(
      [P('MARIA SOFIA DE OLIVEIRA SANTOS', 'A'), P('UNIÃO FEDERAL (AGU)', 'P')],
      'Maria Sofia de Oliveira',
    );
    expect(r.map((d) => d.classe)).toEqual(['federal']);
  });

  it('quando todo mundo vem no polo A, relaxa em vez de devolver vazio', () => {
    // Comum em 1ª instância: o DJEN lista intimados, não partes formais, e às
    // vezes marca todo mundo como ativo. Devolver vazio esconderia o devedor.
    const r = devedoresProvaveis(
      [P('MARIA ANTONIA DOS SANTOS', 'A'), P('RESTAURANTE CASA DA PRAIA LTDA', 'A')],
      'Maria Antonia dos Santos',
    );
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe('RESTAURANTE CASA DA PRAIA LTDA');
  });

  it('não duplica a mesma parte repetida em publicações diferentes', () => {
    const r = devedoresProvaveis(
      [P('ESTADO DE ALAGOAS', 'P'), P('Estado de Alagoas', 'P'), P('ESTADO DE ALAGOAS', 'T')],
      'Fulano',
    );
    expect(r).toHaveLength(1);
  });

  it('sem contraparte identificável devolve lista vazia', () => {
    // Acontece muito: publicação de 1ª instância só intima o advogado do autor.
    const r = devedoresProvaveis([P('WALDIRIA MARIA SIRQUEIRA AYRES', 'A')], 'Waldiria');
    expect(r).toEqual([]);
  });
});

describe('classeDominante', () => {
  it('o ente público manda num processo com devedor misto', () => {
    // Litisconsórcio passivo com Estado e empresa é prospect pelo Estado.
    const devedores = [
      classificarDevedor('CONSTRUTORA XYZ LTDA'),
      classificarDevedor('ESTADO DE ALAGOAS'),
    ];
    expect(classeDominante(devedores)).toBe('estadual');
  });

  it('federal ganha de estadual', () => {
    expect(
      classeDominante([classificarDevedor('ESTADO DE ALAGOAS'), classificarDevedor('UNIÃO')]),
    ).toBe('federal');
  });

  it('sem devedor identificado, assume privado em vez de inventar prospect', () => {
    expect(classeDominante([])).toBe('privado');
  });
});
