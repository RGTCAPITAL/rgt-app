-- =============================================================================
-- 016_dd_judit_consultas_operacao_nullable.sql
--
-- Motivo: prospecção (pré-lead) roda Judit ANTES de existir operação.
-- Tornar operacao_id nullable + ajustar policies pra aceitar consulta "cold".
--
-- Aplicado via: Supabase MCP
-- =============================================================================

ALTER TABLE dd_judit_consultas ALTER COLUMN operacao_id DROP NOT NULL;

COMMENT ON COLUMN dd_judit_consultas.operacao_id IS
  'Operação relacionada. NULL quando consulta é feita em prospecção (pré-operação).';

DROP POLICY IF EXISTS "dd_judit_consultas_select" ON dd_judit_consultas;
CREATE POLICY "dd_judit_consultas_select"
  ON dd_judit_consultas FOR SELECT TO authenticated
  USING (
    operacao_id IS NULL
      AND public.get_user_role() IN ('admin','gestao','broker','juridico')
    OR
    operacao_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM operacoes o WHERE o.id = operacao_id)
  );

DROP POLICY IF EXISTS "dd_judit_consultas_insert" ON dd_judit_consultas;
CREATE POLICY "dd_judit_consultas_insert"
  ON dd_judit_consultas FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() IN ('admin','gestao','juridico')
  );
