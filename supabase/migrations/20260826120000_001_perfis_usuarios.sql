-- =============================================================================
-- 001_perfis_usuarios.sql
--
-- Fundação de autenticação da RGT: perfis + usuarios ligados a auth.users
-- Aplicar em: SQL Editor do Supabase Dashboard
-- Data: 2026-08-26
-- Issue: RGT-11
--
-- IMPORTANTE: hoje aplicamos manualmente via SQL Editor. Quando migrarmos pra
-- Supabase CLI (issue RGT-45), este arquivo já está no formato correto.
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Tabela perfis (tipos de acesso)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE perfis (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text        UNIQUE NOT NULL CHECK (slug IN ('admin', 'gestao', 'juridico', 'broker')),
  nome         text        NOT NULL,
  descricao    text,
  permissoes   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  perfis             IS 'Tipos de acesso ao sistema. Slug determina permissões via RLS.';
COMMENT ON COLUMN perfis.permissoes  IS 'Flags específicas por perfil. Ex: pode_esfera_municipal, pode_convidar_usuarios.';

-- Seed dos 4 perfis
INSERT INTO perfis (slug, nome, descricao, permissoes) VALUES
  ('admin', 'Administrador',
   'Acesso total ao sistema. Mateo e Renato.',
   '{"pode_esfera_municipal": true, "pode_convidar_usuarios": true, "pode_gerenciar_perfis": true}'::jsonb),
  ('gestao', 'Gestão',
   'Time interno RGT (Beatriz e futuros funcionários operacionais). Vê tudo, autoriza mudança de etapa.',
   '{"pode_esfera_municipal": false, "pode_convidar_usuarios": true, "pode_gerenciar_perfis": false}'::jsonb),
  ('juridico', 'Jurídico',
   'Advogado interno (Robson). Cria pareceres jurídicos, revisa parecer da IA jurídica.',
   '{"pode_esfera_municipal": false, "pode_convidar_usuarios": false, "pode_gerenciar_perfis": false}'::jsonb),
  ('broker', 'Broker/Parceiro',
   'Advogado parceiro externo. Só vê e edita operações que ele mesmo cadastrou.',
   '{"pode_esfera_municipal": false, "pode_convidar_usuarios": false, "pode_gerenciar_perfis": false}'::jsonb);


-- ────────────────────────────────────────────────────────────────
-- 2. Tabela usuarios (extensão de auth.users)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE usuarios (
  id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text        UNIQUE NOT NULL,
  nome         text,
  perfil_id    uuid        REFERENCES perfis(id) ON DELETE SET NULL,
  ativo        boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  usuarios           IS 'Perfil aplicacional do usuário. Criado automaticamente via trigger quando alguém se cadastra no Supabase Auth. perfil_id NULL = aguardando admin definir.';
COMMENT ON COLUMN usuarios.perfil_id IS 'NULL até admin definir. Sem perfil, RLS bloqueia acesso a operações/leads.';

CREATE INDEX idx_usuarios_perfil_id ON usuarios(perfil_id);
CREATE INDEX idx_usuarios_ativo     ON usuarios(ativo) WHERE ativo = true;


-- ────────────────────────────────────────────────────────────────
-- 3. Trigger: cria usuario auto quando alguém se cadastra em auth.users
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usuarios (id, email, nome, perfil_id)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'nome',  -- opcional, vem do signup metadata
    NULL                              -- sem perfil, admin precisa definir depois
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();


-- ────────────────────────────────────────────────────────────────
-- 4. Trigger updated_at (auto atualiza timestamp em UPDATE)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER usuarios_set_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


-- ────────────────────────────────────────────────────────────────
-- 5. Função helper pra buscar role do usuário atual
--    (SECURITY DEFINER evita recursão infinita em RLS)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.slug
  FROM usuarios u
  JOIN perfis p ON p.id = u.perfil_id
  WHERE u.id = auth.uid()
$$;

COMMENT ON FUNCTION public.get_user_role() IS 'Retorna slug do perfil do usuário autenticado. Uso em RLS: public.get_user_role() = ''admin''.';


-- ────────────────────────────────────────────────────────────────
-- 6. Row Level Security (RLS)
-- ────────────────────────────────────────────────────────────────

ALTER TABLE perfis   ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;

-- perfis: qualquer autenticado pode ler (dropdown de perfis, etc.)
CREATE POLICY "perfis_select_authenticated"
  ON perfis FOR SELECT
  TO authenticated
  USING (true);

-- usuarios: usuário pode ler o próprio registro
CREATE POLICY "usuarios_select_self"
  ON usuarios FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- usuarios: admin e gestao veem todos os usuários
CREATE POLICY "usuarios_select_admin_gestao"
  ON usuarios FOR SELECT
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'gestao'));

-- usuarios: usuário pode atualizar próprio nome
--   (RLS não deixa mudar perfil_id/ativo por si mesmo — só admin faz isso)
CREATE POLICY "usuarios_update_self"
  ON usuarios FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- usuarios: admin atualiza tudo em qualquer usuário
CREATE POLICY "usuarios_update_admin"
  ON usuarios FOR UPDATE
  TO authenticated
  USING (public.get_user_role() = 'admin');
