-- =============================================================================
-- 004_operacoes_v2.sql
--
-- Refatoração de operacoes após mapeamento do Lajedo Capital (2026-09-02).
-- Aplicar em: SQL Editor do Supabase Dashboard
-- Issue: RGT-46
--
-- Depende de: 001_perfis_usuarios.sql, 002_operacoes.sql, 003_suporte.sql
--
-- ATENÇÃO: essa migration assume que operacoes está VAZIA (sem dados reais).
-- Se houver dados, revisar o DROP TYPE especie_ativo antes de aplicar.
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Adotar vocabulário do mercado: credor → cedente, lua → loa
-- ────────────────────────────────────────────────────────────────

ALTER TABLE operacoes RENAME COLUMN credor_nome TO cedente_nome;
ALTER TABLE operacoes RENAME COLUMN credor_cpf  TO cedente_cpf;
ALTER TABLE operacoes RENAME COLUMN lua         TO loa;

ALTER INDEX idx_operacoes_credor_cpf RENAME TO idx_operacoes_cedente_cpf;

-- LOA passa a ser opcional (Pré-Precatório não tem LOA ainda)
ALTER TABLE operacoes ALTER COLUMN loa DROP NOT NULL;


-- ────────────────────────────────────────────────────────────────
-- 2. Ampliar enum tipo_ativo com Pré-Precatório e Pré-RPV
-- ────────────────────────────────────────────────────────────────

ALTER TYPE tipo_ativo ADD VALUE IF NOT EXISTS 'pre_precatorio';
ALTER TYPE tipo_ativo ADD VALUE IF NOT EXISTS 'pre_rpv';


-- ────────────────────────────────────────────────────────────────
-- 3. Simplificar enum especie_ativo (4 → 3 valores)
--
--    Antes: credito_total, contratual, sucumbencial, apenas_principal
--    Depois: credito_total, apenas_principal, honorarios
--
--    Estratégia: PostgreSQL não permite REMOVE VALUE em enum.
--    Solução: criar novo enum, migrar coluna, drop antigo, renomear.
-- ────────────────────────────────────────────────────────────────

-- 3.1 — Criar novo enum
CREATE TYPE especie_ativo_v2 AS ENUM (
  'credito_total',      -- servidor + advogado
  'apenas_principal',   -- só a parte do servidor
  'honorarios'          -- só honorários (contratual e sucumbencial caem aqui)
);

-- 3.2 — Alterar coluna operacoes.especie pra usar o novo enum
--       Mapeia contratual + sucumbencial → honorarios
ALTER TABLE operacoes
  ALTER COLUMN especie TYPE especie_ativo_v2
  USING (
    CASE especie::text
      WHEN 'credito_total'    THEN 'credito_total'::especie_ativo_v2
      WHEN 'apenas_principal' THEN 'apenas_principal'::especie_ativo_v2
      WHEN 'contratual'       THEN 'honorarios'::especie_ativo_v2
      WHEN 'sucumbencial'     THEN 'honorarios'::especie_ativo_v2
    END
  );

-- 3.3 — Dropar enum antigo (não tem mais referências)
DROP TYPE especie_ativo;

-- 3.4 — Renomear novo enum pro nome antigo (mantém API do código igual)
ALTER TYPE especie_ativo_v2 RENAME TO especie_ativo;


-- ────────────────────────────────────────────────────────────────
-- 4. Adicionar campos novos
-- ────────────────────────────────────────────────────────────────

ALTER TABLE operacoes
  ADD COLUMN data_autuacao        date,
  ADD COLUMN percentual_aquisicao numeric(5, 2) NOT NULL DEFAULT 100
    CHECK (percentual_aquisicao > 0 AND percentual_aquisicao <= 100),
  ADD COLUMN pss_ativo            boolean       NOT NULL DEFAULT false,
  ADD COLUMN pss_pct              numeric(5, 2)
    CHECK (pss_pct IS NULL OR (pss_pct >= 0 AND pss_pct <= 100)),
  ADD COLUMN rra_ativo            boolean       NOT NULL DEFAULT false,
  ADD COLUMN rra_meses            integer
    CHECK (rra_meses IS NULL OR rra_meses >= 0);

COMMENT ON COLUMN operacoes.data_autuacao IS
  'Data de entrada do processo no tribunal. Usado em cálculos de prescrição.';
COMMENT ON COLUMN operacoes.percentual_aquisicao IS
  '100 = compra do crédito integral. <100 = compra parcial (negociação de apenas parte).';
COMMENT ON COLUMN operacoes.pss_ativo IS
  'Se true, PSS incide sobre o cálculo. pss_pct define o percentual.';
COMMENT ON COLUMN operacoes.pss_pct IS
  'Plano de Seguridade Social — dedução aplicada quando pss_ativo = true.';
COMMENT ON COLUMN operacoes.rra_ativo IS
  'Se true, IR incide. rra_meses define regra: 0 = IR fixo 3%; >0 = RRA (Rendimento Recebido Acumuladamente).';
COMMENT ON COLUMN operacoes.rra_meses IS
  'Quantidade de meses acumulados pra cálculo de RRA. NULL quando rra_ativo = false.';


-- ────────────────────────────────────────────────────────────────
-- 5. Ajustar constraint de componentes: agora exige pra
--    direito_creditorio, pre_precatorio E pre_rpv
--    (todos os 3 tipos "sem ofício definitivo" precisam de componentes)
-- ────────────────────────────────────────────────────────────────

ALTER TABLE operacoes
  DROP CONSTRAINT operacoes_componentes_direito_creditorio;

ALTER TABLE operacoes
  ADD CONSTRAINT operacoes_componentes_sem_oficio CHECK (
    tipo NOT IN ('direito_creditorio', 'pre_precatorio', 'pre_rpv')
    OR (valor_principal IS NOT NULL AND valor_juros IS NOT NULL AND valor_selic IS NOT NULL)
  );


-- ────────────────────────────────────────────────────────────────
-- 6. Coerência: se rra_ativo=false, rra_meses deve ser NULL
--    E se pss_ativo=false, pss_pct deve ser NULL
-- ────────────────────────────────────────────────────────────────

ALTER TABLE operacoes
  ADD CONSTRAINT operacoes_rra_meses_coerencia CHECK (
    (rra_ativo = false AND rra_meses IS NULL)
    OR (rra_ativo = true)
  ),
  ADD CONSTRAINT operacoes_pss_pct_coerencia CHECK (
    (pss_ativo = false AND pss_pct IS NULL)
    OR (pss_ativo = true AND pss_pct IS NOT NULL)
  );
