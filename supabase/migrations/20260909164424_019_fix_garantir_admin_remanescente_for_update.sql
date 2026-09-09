-- ============================================================================
-- 019: corrige a 018 — `FOR UPDATE` não é permitido junto de agregação.
--
-- A 018 tentou `SELECT count(*) ... FOR UPDATE`, que o Postgres rejeita com
-- "0A000: FOR UPDATE is not allowed with aggregate functions". Sem esse fix o
-- trigger quebra TODO update de perfil_id/ativo em usuarios.
--
-- Solução: o lock vai no subselect (trava as linhas dos outros admins ativos,
-- serializando transações concorrentes) e a contagem fica por fora.
-- ============================================================================

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

  -- Só interessa a transição que remove um admin ativo do conjunto
  IF era_admin AND NOT continua_admin THEN
    -- FOR UPDATE dentro do subselect: trava as linhas dos outros admins ativos
    -- pra serializar transações concorrentes. Duas remoções simultâneas então
    -- não conseguem ambas ver o mesmo total (fecha o TOCTOU).
    SELECT count(*) INTO restantes
    FROM (
      SELECT id
      FROM usuarios
      WHERE perfil_id = admin_id
        AND ativo
        AND id <> OLD.id
      FOR UPDATE
    ) outros_admins;

    IF restantes < 1 THEN
      RAISE EXCEPTION 'Não é possível remover o último admin ativo do sistema'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
