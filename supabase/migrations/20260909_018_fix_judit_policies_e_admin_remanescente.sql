-- ============================================================================
-- 018: corrige policies duplicadas da 016 + protege último admin
--
-- Achados da auditoria 2026-09-03 (ONDA 1):
--  S3: migration 016 fez DROP POLICY com nomes que não existiam
--      ("dd_judit_consultas_select/insert" vs os reais "dd_judit_select_via_operacao"
--      / "dd_judit_insert_time_interno"). Os DROPs viraram no-op e as policies
--      coexistem. RLS avalia permissivas em OR, então a INSERT nova (sem
--      `criado_por = auth.uid()`) permite forjar autoria de consulta paga.
--  C2: guard de "sobra ao menos um admin" era check-then-act na server action
--      (TOCTOU). Dois admins rebaixados em paralelo zeram os admins.
--
-- NOTA: a função abaixo foi corrigida logo em seguida pela migration 019
--       (FOR UPDATE não é permitido junto de agregação).
-- ============================================================================


-- ─── Parte 1: policies canônicas de dd_judit_consultas ──────────────────────

DROP POLICY IF EXISTS "dd_judit_select_via_operacao"  ON dd_judit_consultas;
DROP POLICY IF EXISTS "dd_judit_consultas_select"     ON dd_judit_consultas;
DROP POLICY IF EXISTS "dd_judit_insert_time_interno"  ON dd_judit_consultas;
DROP POLICY IF EXISTS "dd_judit_consultas_insert"     ON dd_judit_consultas;

-- SELECT: consulta de prospecção (operacao_id NULL) exige perfil operacional;
-- consulta ligada a operação herda a visibilidade da própria operação via RLS.
CREATE POLICY "dd_judit_select"
  ON dd_judit_consultas FOR SELECT TO authenticated
  USING (
    CASE
      WHEN operacao_id IS NULL
        THEN public.get_user_role() IN ('admin','gestao','broker','juridico')
      ELSE EXISTS (SELECT 1 FROM operacoes o WHERE o.id = operacao_id)
    END
  );

-- INSERT: mantém o `criado_por = auth.uid()` da 014 (auditoria de crédito Judit
-- precisa atribuir cada consulta ao usuário real que a disparou).
CREATE POLICY "dd_judit_insert"
  ON dd_judit_consultas FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() IN ('admin','gestao','juridico')
    AND criado_por = auth.uid()
  );


-- ─── Parte 2: garantir admin remanescente (fecha TOCTOU) ────────────────────

CREATE OR REPLACE FUNCTION public.garantir_admin_remanescente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id       uuid;
  era_admin      boolean;
  continua_admin boolean;
  restantes      integer;
BEGIN
  SELECT id INTO admin_id FROM perfis WHERE slug = 'admin';
  IF admin_id IS NULL THEN
    RETURN NEW;
  END IF;

  era_admin      := (OLD.perfil_id = admin_id AND OLD.ativo);
  continua_admin := (NEW.perfil_id = admin_id AND NEW.ativo);

  IF era_admin AND NOT continua_admin THEN
    SELECT count(*) INTO restantes
    FROM usuarios
    WHERE perfil_id = admin_id
      AND ativo
      AND id <> OLD.id;

    IF restantes < 1 THEN
      RAISE EXCEPTION 'Não é possível remover o último admin ativo do sistema'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.garantir_admin_remanescente() IS
  'Impede que o último admin ativo seja rebaixado ou desativado. Fecha o TOCTOU que existia só na server action.';

DROP TRIGGER IF EXISTS trg_garantir_admin_remanescente ON usuarios;
CREATE TRIGGER trg_garantir_admin_remanescente
  BEFORE UPDATE OF perfil_id, ativo ON usuarios
  FOR EACH ROW
  EXECUTE FUNCTION public.garantir_admin_remanescente();
