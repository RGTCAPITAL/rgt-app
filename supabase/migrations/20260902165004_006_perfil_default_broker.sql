-- =============================================================================
-- 006_perfil_default_broker.sql
--
-- Bug fix (RGT-53): trigger handle_new_user cria usuario com perfil_id=NULL,
-- que faz RLS bloquear tudo pro user novo (get_user_role retorna NULL).
--
-- Fix: trigger passa a atribuir perfil 'broker' como default. Admin promove
-- pra gestao/juridico/admin depois via UPDATE.
--
-- Aplicar em: Supabase MCP (apply_migration)
-- Depende de: 001_perfis_usuarios.sql
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Redefine handle_new_user pra atribuir perfil broker default
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  broker_perfil_id uuid;
BEGIN
  SELECT id INTO broker_perfil_id FROM public.perfis WHERE slug = 'broker';

  INSERT INTO public.usuarios (id, email, nome, perfil_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    broker_perfil_id
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Cria usuario em public.usuarios ao insertar em auth.users. Atribui perfil broker default (menor privilegio). Admin promove depois.';


-- ────────────────────────────────────────────────────────────────
-- 2. Backfill: users existentes sem perfil viram broker
--    (só afeta se algum sobrou; hoje não há, mas migration deve ser idempotente)
-- ────────────────────────────────────────────────────────────────

UPDATE public.usuarios
   SET perfil_id = (SELECT id FROM public.perfis WHERE slug = 'broker')
 WHERE perfil_id IS NULL;


-- ────────────────────────────────────────────────────────────────
-- 3. Atualiza comentário da coluna (o antigo dizia "NULL = aguardando admin")
-- ────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.usuarios.perfil_id IS
  'Perfil do usuário. Novo cadastro recebe broker default (via trigger). Admin promove pra outros perfis via UPDATE.';
