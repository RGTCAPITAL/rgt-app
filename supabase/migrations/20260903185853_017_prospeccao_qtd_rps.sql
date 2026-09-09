-- =============================================================================
-- 017_prospeccao_qtd_rps.sql
--
-- Motivo: planilhas oficiais do TRT/TJ têm múltiplas linhas por processo
-- (cada linha = 1 RP: juros / honorários / principal atualizado). Broker
-- prospecta o CREDOR (não o RP). Agregamos por CNJ e guardamos a quantidade.
--
-- Aplicado via: Supabase MCP
-- =============================================================================

ALTER TABLE prospeccao_precatorios
  ADD COLUMN qtd_rps int NOT NULL DEFAULT 1 CHECK (qtd_rps > 0);

COMMENT ON COLUMN prospeccao_precatorios.qtd_rps IS
  'Quantidade de RPs agregadas neste processo. >1 quando planilha oficial tem múltiplas linhas do mesmo CNJ.';

-- Limpa o lote antigo pra reimportar agregado
DELETE FROM prospeccao_precatorios WHERE fonte_lote = 'trt19_venc_2027';
