/**
 * Types da Judit API. Placeholders baseados no que a plataforma promete
 * (consulta processual, autos, dados cadastrais). Ajustar após chegar
 * doc real da API + plano API contratado.
 */

/** Resposta da consulta processual por Nº CNJ */
export type ProcessoJudit = {
  numero_cnj: string;
  tribunal?: string;
  vara?: string;
  classe?: string;
  assunto?: string;
  valor_causa?: number;
  data_autuacao?: string;
  data_ultimo_movimento?: string;
  transitou_em_julgado?: boolean;

  partes?: Array<{
    tipo: 'autor' | 'reu' | 'terceiro' | string;
    nome: string;
    cpf_cnpj?: string;
    advogados?: Array<{ nome: string; oab?: string }>;
  }>;

  movimentacoes?: Array<{
    data: string;
    descricao: string;
    tipo?: string;
  }>;

  penhoras?: Array<{
    valor?: number;
    data?: string;
    descricao?: string;
  }>;

  cessoes?: Array<{
    cessionario_nome?: string;
    cessionario_doc?: string;
    data?: string;
  }>;

  // Metadados da própria consulta
  _judit?: {
    consulta_id?: string;
    tempo_ms?: number;
    fonte?: string;
    atualizado_em?: string;
  };
};

/** Resposta bruta que salvamos em dd_judit_consultas.payload_bruto */
export type PayloadJudit = ProcessoJudit | Record<string, unknown>;

/** Red flags derivadas do payload — usadas na UI como badges vermelhos */
export type RedFlag =
  | 'nao_encontrado'
  | 'nao_transitou'
  | 'tem_penhora'
  | 'outro_cessionario'
  | 'regime_especial'
  | 'sem_advogado'
  | 'sem_movimentacao_recente';

export const RED_FLAG_LABEL: Record<RedFlag, string> = {
  nao_encontrado: 'Processo não encontrado no CNJ',
  nao_transitou: 'Não transitou em julgado',
  tem_penhora: 'Tem penhora ativa',
  outro_cessionario: 'Já cedido a outro',
  regime_especial: 'Ente em regime especial',
  sem_advogado: 'Sem advogado cadastrado',
  sem_movimentacao_recente: 'Sem movimentação há +6 meses',
};

/** Resultado da consulta feita pelo server action */
export type ResultadoConsultaJudit =
  | { ok: true; consultaId: string; redFlags: RedFlag[]; dados: ProcessoJudit }
  | { ok: false; erro: string };
