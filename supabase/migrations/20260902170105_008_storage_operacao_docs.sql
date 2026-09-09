-- =============================================================================
-- 008_storage_operacao_docs.sql
--
-- Cria bucket privado `operacao-docs` + RLS policies em storage.objects.
-- Convenção de path: {operacao_id}/{tipo}_{timestamp}.{ext}
--
-- RLS filtra por operação — se user não pode ver operacao (RLS bloqueia),
-- também não vê docs. EXISTS confia na RLS de operacoes.
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Issue: RGT-22
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Cria bucket privado
-- ────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('operacao-docs', 'operacao-docs', false, 20971520)  -- 20MB
ON CONFLICT (id) DO NOTHING;


-- ────────────────────────────────────────────────────────────────
-- 2. Policies em storage.objects
--    Todas restringem por bucket_id + validam via join em operacoes
-- ────────────────────────────────────────────────────────────────

-- SELECT: usuário vê arquivo se pode ver a operação (herda RLS de operacoes)
CREATE POLICY "operacao_docs_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'operacao-docs'
    AND EXISTS (
      SELECT 1 FROM public.operacoes
       WHERE id::text = split_part(objects.name, '/', 1)
    )
  );

-- INSERT: usuário pode adicionar arquivo em operação que ele vê
CREATE POLICY "operacao_docs_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'operacao-docs'
    AND EXISTS (
      SELECT 1 FROM public.operacoes
       WHERE id::text = split_part(objects.name, '/', 1)
    )
  );

-- DELETE: só quem uploadou ou admin
CREATE POLICY "operacao_docs_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'operacao-docs'
    AND (owner = auth.uid() OR public.get_user_role() = 'admin')
  );

-- UPDATE não tem policy — arquivos são imutáveis (delete + re-upload se precisar trocar)
