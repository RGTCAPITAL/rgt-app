-- =============================================================================
-- 011_cedente_demografia.sql
--
-- Adiciona dados demográficos do cedente que habilitam 2 regras da RGT
-- previamente sem campo no schema:
--   (a) idade > 75 anos → laudo médico obrigatório no checklist
--   (b) estado civil = casado → certidão casamento obrigatória
--       (caso contrário: certidão nascimento)
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Issue: RGT-66
-- =============================================================================

ALTER TABLE operacoes
  ADD COLUMN cedente_data_nascimento date,
  ADD COLUMN cedente_estado_civil    text
    CHECK (cedente_estado_civil IS NULL
      OR cedente_estado_civil IN ('solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel'));

COMMENT ON COLUMN operacoes.cedente_data_nascimento IS
  'Data de nascimento do cedente. Usado pra derivar >75 anos → laudo médico obrigatório no checklist.';
COMMENT ON COLUMN operacoes.cedente_estado_civil IS
  'Estado civil do cedente. Se casado, exige certidão casamento; caso contrário, certidão nascimento.';
