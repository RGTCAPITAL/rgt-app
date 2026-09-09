-- ============================================================================
-- 029: expõe o histórico de migrations pro teste de sincronia (RGT-45)
--
-- O schema `supabase_migrations` não é exposto pelo PostgREST (PGRST106), e
-- expor o schema inteiro seria exagero. Esta função devolve só a lista de
-- versions aplicadas.
--
-- Consumida por `lib/__tests__/migrations.integration.test.ts`, que falha se o
-- que está no git divergir do que está aplicado. O risco é concreto: as
-- migrations são aplicadas via MCP e o arquivo salvo depois, à mão — nesta
-- mesma sessão duas migrations ficaram sem arquivo, e quem recriasse o banco
-- pelo git teria um schema silenciosamente diferente.
--
-- SECURITY DEFINER porque o schema é interno. Devolve só timestamps e nomes de
-- migration — nenhum dado de negócio.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.migrations_aplicadas()
RETURNS TABLE (version text, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = supabase_migrations, public
AS $$
  SELECT m.version, m.name
  FROM supabase_migrations.schema_migrations m
  ORDER BY m.version;
$$;

COMMENT ON FUNCTION public.migrations_aplicadas() IS
  'Lista as migrations aplicadas. Usada pelo teste que garante que os arquivos no git descrevem o banco real (RGT-45).';

GRANT EXECUTE ON FUNCTION public.migrations_aplicadas() TO authenticated;
