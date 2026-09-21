import { describe, expect, it } from 'vitest';
import { mapCruParaPublicacao, mascararCnj, normalizarCnj, paraLinhaBanco } from './mappers';
import type { DjenItem } from './types.raw';

const ITEM_BASE: DjenItem = {
  id: 731000000,
  hash: 'abcXYZ123456789abcXYZ12345678',
  data_disponibilizacao: '2026-09-21',
  datadisponibilizacao: '21/09/2026',
  siglaTribunal: 'TJAL',
  tipoComunicacao: 'Intimação',
  nomeOrgao: 'Diretoria de Precatório e RPV - Presidência',
  idOrgao: 9003,
  texto: 'Intime-se o cessionário Prosperous FIDC ...',
  numero_processo: '05000105120238020033',
  numeroprocessocommascara: '0500010-51.2023.8.02.0033',
  meio: 'D',
  meiocompleto: 'Diário de Justiça Eletrônico Nacional',
  link: 'https://pje.tjal.jus.br/x/y',
  tipoDocumento: 'Despacho',
  nomeClasse: 'PRECATÓRIO',
  codigoClasse: '1265',
  numeroComunicacao: 1,
  ativo: true,
  status: 'P',
  motivo_cancelamento: null,
  data_cancelamento: null,
  destinatarios: [
    { comunicacao_id: 731000000, nome: 'JOSÉ VALENTIM DA SILVA', polo: 'A' },
    { comunicacao_id: 731000000, nome: 'MUNICÍPIO DE QUEBRANGULO', polo: 'P' },
  ],
  destinatarioadvogados: [
    {
      id: 999,
      comunicacao_id: 731000000,
      advogado_id: 8199,
      created_at: '2026-09-21T10:00:00',
      updated_at: '2026-09-21T10:00:00',
      advogado: {
        id: 8199,
        nome: 'FERNANDA ÁVILA SOUSA',
        numero_oab: '8199',
        uf_oab: 'AL',
      },
    },
  ],
};

describe('normalizarCnj / mascararCnj', () => {
  it('remove máscara', () => {
    expect(normalizarCnj('0500010-51.2023.8.02.0033')).toBe('05000105120238020033');
  });
  it('aceita string já sem máscara', () => {
    expect(normalizarCnj('05000105120238020033')).toBe('05000105120238020033');
  });
  it('aplica máscara padrão', () => {
    expect(mascararCnj('05000105120238020033')).toBe('0500010-51.2023.8.02.0033');
  });
  it('devolve original quando CNJ não tem 20 dígitos', () => {
    expect(mascararCnj('123')).toBe('123');
  });
});

describe('mapCruParaPublicacao', () => {
  it('preserva id, hash e datas', () => {
    const pub = mapCruParaPublicacao(ITEM_BASE);
    expect(pub.id).toBe(731000000);
    expect(pub.hash).toBe('abcXYZ123456789abcXYZ12345678');
    expect(pub.dataDisponibilizacao).toBe('2026-09-21');
  });

  it('renomeia numero_oab → oab e uf_oab → uf, achata advogados', () => {
    const pub = mapCruParaPublicacao(ITEM_BASE);
    expect(pub.advogados).toHaveLength(1);
    expect(pub.advogados[0]).toEqual({
      id: 8199,
      nome: 'FERNANDA ÁVILA SOUSA',
      oab: '8199',
      uf: 'AL',
    });
  });

  it('marca destinatários mascarados', () => {
    const item: DjenItem = {
      ...ITEM_BASE,
      destinatarios: [
        { comunicacao_id: 1, nome: 'E.A.D.O.', polo: 'A' },
        { comunicacao_id: 1, nome: 'ESTADO DE ALAGOAS', polo: 'P' },
      ],
    };
    const pub = mapCruParaPublicacao(item);
    expect(pub.destinatarios[0].mascarado).toBe(true);
    expect(pub.destinatarios[1].mascarado).toBe(false);
  });

  it('roda red flags e extração de fatos', () => {
    const pub = mapCruParaPublicacao(ITEM_BASE);
    // Item base fala em "cessionário Prosperous FIDC" — bate 2 padrões
    expect(pub.redFlags.some((f) => f.codigo === '2')).toBe(true);
  });

  it('preserva o payload cru em _raw pra auditoria', () => {
    const pub = mapCruParaPublicacao(ITEM_BASE);
    expect(pub._raw).toBe(ITEM_BASE);
  });

  it('lida com destinatarioadvogados vazio (~2% dos items)', () => {
    const item = { ...ITEM_BASE, destinatarioadvogados: [] };
    const pub = mapCruParaPublicacao(item);
    expect(pub.advogados).toEqual([]);
  });
});

describe('paraLinhaBanco', () => {
  it('gera colunas na convenção snake_case do banco', () => {
    const linha = paraLinhaBanco(mapCruParaPublicacao(ITEM_BASE));
    expect(linha.id).toBe(731000000);
    expect(linha.sigla_tribunal).toBe('TJAL');
    expect(linha.numero_processo).toBe('05000105120238020033');
    expect(linha.numero_processo_mascara).toBe('0500010-51.2023.8.02.0033');
    expect(linha.codigo_classe).toBe('1265');
    expect(linha.raw).toBe(ITEM_BASE);
  });

  it('serializa red_flags e destinatarios como jsonb-friendly', () => {
    const linha = paraLinhaBanco(mapCruParaPublicacao(ITEM_BASE));
    expect(Array.isArray(linha.red_flags)).toBe(true);
    expect(Array.isArray(linha.destinatarios)).toBe(true);
    // Cada destinatário traz `mascarado` — a trigger derivada usa esse campo
    expect((linha.destinatarios as Array<{ mascarado: boolean }>)[0].mascarado).toBe(false);
  });

  it('cancelamento null vira colunas null', () => {
    const linha = paraLinhaBanco(mapCruParaPublicacao(ITEM_BASE));
    expect(linha.data_cancelamento).toBeNull();
    expect(linha.motivo_cancelamento).toBeNull();
  });
});
