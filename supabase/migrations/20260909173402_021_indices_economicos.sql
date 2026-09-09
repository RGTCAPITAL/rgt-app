-- ============================================================================
-- 021: séries de índices econômicos pra correção monetária de precatórios
--
-- Por que persistir em vez de consultar a API do BCB na hora do cálculo:
--  1. Auditoria — precisamos poder provar QUAL valor foi usado numa proposta
--     feita meses atrás. O IBGE às vezes revisa valores passados.
--  2. Reprodutibilidade — recalcular a mesma operação tem que dar o mesmo
--     número, hoje e daqui a um ano.
--  3. A API do BCB fica atrás de um WAF que responde HTML com HTTP 200 e não
--     tem SLA. Não dá pra deixar no caminho crítico de uma proposta.
--
-- Os índices mensais mudam 1x por mês; sincronização é barata.
-- ============================================================================

CREATE TYPE serie_indice AS ENUM (
  'ipca',      -- SGS 433 · IBGE 1737/63 — correção de precatório pós EC 136
  'ipca_15',   -- SGS 7478 — correção na fase pré-requisitório (Manual CJF 2026)
  'inpc',      -- SGS 188 — benefícios previdenciários
  'selic',     -- SGS 4390 (acumulada no mês) — trava da EC 136 e regime dez/2021-ago/2025
  'poupanca',  -- SGS 196 — juros de mora maio/2012 a nov/2021
  'tr'         -- SGS 7811 — correção de precatório 10/12/2009 a 25/03/2015
);

CREATE TABLE indices_economicos (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  serie          serie_indice  NOT NULL,

  -- Sempre o 1º dia do mês de referência (competência), nunca a data de divulgação
  competencia    date          NOT NULL,

  -- Variação percentual no mês (ex: 0.70 = 0,70%)
  variacao_pct   numeric(12,6) NOT NULL,

  -- Número-índice, quando a fonte publica (hoje só IPCA, via IBGE agregado 1737 var 2266).
  -- Permite fator = indice_final / indice_inicial numa divisão só, em vez de encadear
  -- N variações já arredondadas em 2 casas — que acumula deriva (medido: diverge na
  -- 7ª casa em 6 meses, e precatório antigo tem 200+ meses de correção).
  numero_indice  numeric(18,6),

  -- Rastro de origem pra auditoria: qual série de qual fonte produziu este número
  fonte          text          NOT NULL,
  coletado_em    timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT indices_competencia_dia_1 CHECK (EXTRACT(DAY FROM competencia) = 1),
  CONSTRAINT indices_unico_por_competencia UNIQUE (serie, competencia)
);

COMMENT ON TABLE indices_economicos IS
  'Séries mensais de índices oficiais. Snapshot persistido: o valor usado num cálculo não pode mudar depois (o IBGE revisa valores passados).';
COMMENT ON COLUMN indices_economicos.competencia IS
  'Primeiro dia do mês de REFERÊNCIA do índice, não da divulgação.';
COMMENT ON COLUMN indices_economicos.numero_indice IS
  'Número-índice quando a fonte publica. Preferir para fator de correção: uma divisão em vez de N multiplicações arredondadas.';
COMMENT ON COLUMN indices_economicos.fonte IS
  'Identificador da origem, ex: bcb_sgs_433, ibge_1737_2266. Auditoria.';

CREATE INDEX idx_indices_serie_competencia ON indices_economicos(serie, competencia DESC);

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Índice econômico é dado público (IBGE/BCB). Qualquer usuário do sistema lê;
-- escrita só pelo job de sincronização (service role, que bypassa RLS).

ALTER TABLE indices_economicos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "indices_select_autenticados"
  ON indices_economicos FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "indices_insert_admin"
  ON indices_economicos FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'gestao'));

CREATE POLICY "indices_update_admin"
  ON indices_economicos FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');
