-- =============================================================================
-- 007_rls_hardening.sql
--
-- Auditoria de RLS (RGT-14) revelou 2 bugs críticos:
--
-- 1. PRIVILEGE ESCALATION: `usuarios_update_self` deixa user mudar próprio
--    perfil_id / ativo. Um user poderia se auto-promover pra admin. RLS
--    WITH CHECK do Postgres só valida valor novo, não compara com OLD, então
--    precisa trigger BEFORE UPDATE.
--
-- 2. BUG SILENCIOSO: `etapas_operacao` não tem policy de UPDATE. Server action
--    mudarEtapa faz UPDATE pra gravar observacao, mas RLS bloqueia. Efeito:
--    observação da mudança de etapa nunca foi gravada.
--
-- Aplicar em: Supabase MCP (apply_migration)
-- Depende de: 001, 002, 003
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- FIX 1: bloquear escalação de privilégio em usuarios
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bloquear_escalacao_privilegio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admin pode mudar qualquer coisa em qualquer user
  IF public.get_user_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  -- Não-admin: bloqueia mudança em perfil_id
  IF NEW.perfil_id IS DISTINCT FROM OLD.perfil_id THEN
    RAISE EXCEPTION 'Somente admin pode mudar perfil de usuário.';
  END IF;

  -- Não-admin: bloqueia mudança em ativo
  IF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    RAISE EXCEPTION 'Somente admin pode ativar/desativar usuários.';
  END IF;

  -- Não-admin: bloqueia mudança em id (defensivo)
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Não é possível mudar o id do usuário.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.bloquear_escalacao_privilegio() IS
  'Trigger BEFORE UPDATE em usuarios: bloqueia não-admin de mudar perfil_id / ativo / id (privilege escalation).';

DROP TRIGGER IF EXISTS usuarios_bloquear_escalacao ON usuarios;
CREATE TRIGGER usuarios_bloquear_escalacao
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE PROCEDURE public.bloquear_escalacao_privilegio();


-- ────────────────────────────────────────────────────────────────
-- FIX 2: policy de UPDATE em etapas_operacao (pra observação)
--        Só admin/gestao — quem tem permissão de mudar etapa
-- ────────────────────────────────────────────────────────────────

CREATE POLICY "etapas_operacao_update_admin_gestao"
  ON etapas_operacao FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'gestao'))
  WITH CHECK (public.get_user_role() IN ('admin', 'gestao'));
