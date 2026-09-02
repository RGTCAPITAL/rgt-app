-- =============================================================================
-- 012_ente_situacao.sql
--
-- Anti-objetivo do Renato: "não opera estado em regime especial / dívida
-- fundada". Sem campo antes, broker cadastrava operação sem bloqueio.
--
-- Adiciona flag situacao em entes_devedores + trigger em operacoes que
-- bloqueia INSERT/UPDATE se ente está em regime_especial (exceto admin, que
-- pode overrule pra exceções).
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Issue: RGT-67
-- =============================================================================

ALTER TABLE entes_devedores
  ADD COLUMN situacao text NOT NULL DEFAULT 'regular'
    CHECK (situacao IN ('regular', 'regime_especial'));

COMMENT ON COLUMN entes_devedores.situacao IS
  'Situação fiscal do ente. regime_especial = estado/ente sob RREO ou dívida fundada; RGT NÃO opera. Trigger bloqueia INSERT em operacoes se != admin.';

CREATE INDEX idx_entes_devedores_situacao ON entes_devedores(situacao)
  WHERE situacao = 'regime_especial';

CREATE OR REPLACE FUNCTION public.check_ente_regime_especial()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  situacao_ente text;
BEGIN
  IF NEW.ente_devedor_id IS NULL THEN RETURN NEW; END IF;

  SELECT situacao INTO situacao_ente FROM entes_devedores WHERE id = NEW.ente_devedor_id;

  IF situacao_ente = 'regime_especial' AND public.get_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Ente devedor está em regime especial — RGT não opera. Se for exceção, admin precisa cadastrar.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER operacoes_check_regime_especial
  BEFORE INSERT OR UPDATE OF ente_devedor_id ON operacoes
  FOR EACH ROW EXECUTE PROCEDURE public.check_ente_regime_especial();
