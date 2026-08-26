-- =============================================================================
-- 003_suporte.sql
--
-- Tabelas de suporte à operacoes: histórico de etapas, comentários, documentos.
-- Plus: trigger que registra mudança de etapa automaticamente.
-- Aplicar em: SQL Editor do Supabase Dashboard
-- Data: 2026-08-26
-- Issue: RGT-13
--
-- Depende de: 001_perfis_usuarios.sql, 002_operacoes.sql
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Enum tipo_documento
-- ────────────────────────────────────────────────────────────────

CREATE TYPE tipo_documento AS ENUM (
  -- Identidade
  'rg',
  'cpf',
  'comprovante_residencia',
  'dados_bancarios',

  -- Estado civil
  'certidao_nascimento',
  'certidao_casamento',

  -- Certidões (checklist da RGT)
  'certidao_civel_tj_estadual',
  'certidao_civel_federal_1_grau',
  'certidao_civel_federal_2_grau',
  'certidao_criminal_tj',
  'certidao_fiscal_tj',

  -- Idade avançada
  'laudo_medico',  -- obrigatório se credor >75 anos

  -- Documentos do processo
  'decisao_homologatoria',  -- obrigatório pra direito creditório
  'calculos',               -- obrigatório pra direito creditório
  'oficio_requisitorio',    -- obrigatório pra precatório
  'autos_processo',
  'procuracao',
  'contrato_cessao',

  'outro'
);


-- ────────────────────────────────────────────────────────────────
-- 2. Tabela etapas_operacao — histórico do workflow
-- ────────────────────────────────────────────────────────────────

CREATE TABLE etapas_operacao (
  id                  uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  operacao_id         uuid              NOT NULL REFERENCES operacoes(id) ON DELETE CASCADE,
  etapa               etapa_operacao    NOT NULL,
  entrou_em           timestamptz       NOT NULL DEFAULT now(),
  saiu_em             timestamptz,                    -- NULL = etapa atual
  autorizado_por_id   uuid                        REFERENCES usuarios(id) ON DELETE SET NULL,
  observacao          text,
  created_at          timestamptz       NOT NULL DEFAULT now()
);

COMMENT ON TABLE  etapas_operacao IS
  'Histórico de todas as transições de etapa de uma operação. Alimentada automaticamente por trigger em operacoes.';
COMMENT ON COLUMN etapas_operacao.saiu_em IS
  'NULL = etapa atual. Quando etapa muda, essa linha ganha saiu_em = now() e uma nova é inserida com entrou_em = now() e saiu_em = NULL.';

CREATE INDEX idx_etapas_operacao_operacao_id ON etapas_operacao(operacao_id);
CREATE INDEX idx_etapas_operacao_atual       ON etapas_operacao(operacao_id) WHERE saiu_em IS NULL;
CREATE INDEX idx_etapas_operacao_entrou_em   ON etapas_operacao(entrou_em DESC);


-- ────────────────────────────────────────────────────────────────
-- 3. Trigger que auto-registra histórico de etapa
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_etapa_operacao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ao criar operação: primeira linha de histórico
  IF TG_OP = 'INSERT' THEN
    INSERT INTO etapas_operacao (operacao_id, etapa, entrou_em, autorizado_por_id)
    VALUES (NEW.id, NEW.etapa_atual, now(), auth.uid());
    RETURN NEW;
  END IF;

  -- Ao mudar etapa_atual: fecha linha atual, abre nova
  IF TG_OP = 'UPDATE' AND OLD.etapa_atual IS DISTINCT FROM NEW.etapa_atual THEN
    UPDATE etapas_operacao
       SET saiu_em = now()
     WHERE operacao_id = NEW.id AND saiu_em IS NULL;

    INSERT INTO etapas_operacao (operacao_id, etapa, entrou_em, autorizado_por_id)
    VALUES (NEW.id, NEW.etapa_atual, now(), auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER operacoes_log_etapa
  AFTER INSERT OR UPDATE OF etapa_atual ON operacoes
  FOR EACH ROW EXECUTE PROCEDURE public.log_etapa_operacao();


-- ────────────────────────────────────────────────────────────────
-- 4. Tabela comentarios
-- ────────────────────────────────────────────────────────────────

CREATE TABLE comentarios (
  id            uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  operacao_id   uuid              NOT NULL REFERENCES operacoes(id) ON DELETE CASCADE,
  etapa         etapa_operacao,                       -- nullable: comentário geral vs vinculado a etapa
  autor_id      uuid                          REFERENCES usuarios(id) ON DELETE SET NULL,
  texto         text              NOT NULL CHECK (char_length(texto) > 0),
  created_at    timestamptz       NOT NULL DEFAULT now(),
  updated_at    timestamptz       NOT NULL DEFAULT now()
);

COMMENT ON TABLE  comentarios IS
  'Mensagens do time em uma operação. Podem ser vinculadas a uma etapa específica (contexto) ou gerais.';
COMMENT ON COLUMN comentarios.etapa IS
  'Etapa em que o comentário foi feito. Ajuda a filtrar comentários por fase do workflow.';

CREATE INDEX idx_comentarios_operacao_id ON comentarios(operacao_id);
CREATE INDEX idx_comentarios_created_at  ON comentarios(created_at DESC);

CREATE TRIGGER comentarios_set_updated_at
  BEFORE UPDATE ON comentarios
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


-- ────────────────────────────────────────────────────────────────
-- 5. Tabela documentos
-- ────────────────────────────────────────────────────────────────

CREATE TABLE documentos (
  id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  operacao_id     uuid              NOT NULL REFERENCES operacoes(id) ON DELETE CASCADE,
  tipo            tipo_documento    NOT NULL,
  nome_original   text              NOT NULL,
  storage_path    text              NOT NULL UNIQUE,     -- path no bucket Supabase Storage
  mime_type       text,
  tamanho_bytes   bigint            CHECK (tamanho_bytes IS NULL OR tamanho_bytes >= 0),
  uploaded_by     uuid                          REFERENCES usuarios(id) ON DELETE SET NULL,
  uploaded_at     timestamptz       NOT NULL DEFAULT now()
);

COMMENT ON TABLE  documentos IS
  'Metadados de arquivos anexados a operações. O arquivo em si vive em Supabase Storage (bucket a criar na RGT-22).';
COMMENT ON COLUMN documentos.storage_path IS
  'Caminho dentro do bucket privado do Supabase Storage. Convenção: {operacao_id}/{tipo}_{timestamp}.{ext}';

CREATE INDEX idx_documentos_operacao_id ON documentos(operacao_id);
CREATE INDEX idx_documentos_tipo        ON documentos(operacao_id, tipo);


-- ────────────────────────────────────────────────────────────────
-- 6. Row Level Security (RLS)
--    Acesso segue da tabela pai (operacoes) via EXISTS —
--    quando RLS de operacoes bloqueia, EXISTS retorna false
--    e o registro relacionado também some.
-- ────────────────────────────────────────────────────────────────

ALTER TABLE etapas_operacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE comentarios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos      ENABLE ROW LEVEL SECURITY;

-- ETAPAS_OPERACAO
CREATE POLICY "etapas_operacao_select" ON etapas_operacao
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM operacoes WHERE operacoes.id = etapas_operacao.operacao_id));

-- INSERT/UPDATE só via trigger (que é SECURITY DEFINER e bypassa RLS).
-- Não criamos policy pra INSERT/UPDATE — RLS bloqueia por default sem policy.

CREATE POLICY "etapas_operacao_delete_admin" ON etapas_operacao
  FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');

-- COMENTARIOS
CREATE POLICY "comentarios_select" ON comentarios
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM operacoes WHERE operacoes.id = comentarios.operacao_id));

CREATE POLICY "comentarios_insert" ON comentarios
  FOR INSERT TO authenticated
  WITH CHECK (
    autor_id = auth.uid()
    AND EXISTS (SELECT 1 FROM operacoes WHERE operacoes.id = comentarios.operacao_id)
  );

CREATE POLICY "comentarios_update_autor" ON comentarios
  FOR UPDATE TO authenticated
  USING (autor_id = auth.uid())
  WITH CHECK (autor_id = auth.uid());

CREATE POLICY "comentarios_delete_autor_ou_admin" ON comentarios
  FOR DELETE TO authenticated
  USING (autor_id = auth.uid() OR public.get_user_role() = 'admin');

-- DOCUMENTOS
CREATE POLICY "documentos_select" ON documentos
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM operacoes WHERE operacoes.id = documentos.operacao_id));

CREATE POLICY "documentos_insert" ON documentos
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (SELECT 1 FROM operacoes WHERE operacoes.id = documentos.operacao_id)
  );

CREATE POLICY "documentos_delete_uploader_ou_admin" ON documentos
  FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() OR public.get_user_role() = 'admin');
