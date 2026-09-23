-- =============================================================================
-- 034_origem_lead_importacao.sql
--
-- A planilha do Renato não cabe em nenhuma das origens existentes. Cair em
-- 'outro' perde a rastreabilidade de onde o dado veio, que é justamente o que
-- o art. 9º da LGPD exige informar ao titular.
--
-- Separado da 033 porque ALTER TYPE ... ADD VALUE tem restrição transacional
-- em Postgres e o valor novo não pode ser usado na mesma transação em que é
-- criado.
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Depende de: 010 (leads, que cria origem_lead)
-- =============================================================================

ALTER TYPE origem_lead ADD VALUE IF NOT EXISTS 'importacao_planilha';
ALTER TYPE origem_lead ADD VALUE IF NOT EXISTS 'lista_processual';
