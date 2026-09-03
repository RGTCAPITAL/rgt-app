-- =============================================================================
-- 014_dd_judit.sql
--
-- Persistência das consultas feitas na Judit API pra due diligence de
-- processos judiciais. Cache + histórico + auditoria de créditos gastos.
--
-- Fluxo:
--   Robson (ou trigger auto quando entra em DD Jurídica) → chama Judit
--   → resposta salva em dd_judit_consultas (1 linha por consulta)
--   → operacoes.dd_judit_ultima_id aponta pra última + red_flags derivados
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Issue: RGT-41 (execução) · Milestone: Judit-1 · Deps: 002 (operacoes)
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Tabela dd_judit_consultas
-- ────────────────────────────────────────────────────────────────

CREATE TABLE dd_judit_consultas (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  operacao_id       uuid          NOT NULL REFERENCES operacoes(id) ON DELETE CASCADE,
  numero_processo   text          NOT NULL,
  tipo_consulta     text          NOT NULL DEFAULT 'processo'
                                  CHECK (tipo_consulta IN ('processo', 'historico_cpf', 'autos')),
  payload_bruto     jsonb         NOT NULL,           -- resposta crua da Judit (backup)
  status            text          NOT NULL
                                  CHECK (status IN ('ok', 'not_found', 'error')),
  erro_msg          text,
  credito_gasto     numeric(6,2),                     -- pra rastrear consumo do plano
  criado_por        uuid                    REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at        timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  dd_judit_consultas       IS 'Histórico completo de chamadas à Judit API. Cache + auditoria.';
COMMENT ON COLUMN dd_judit_consultas.payload_bruto IS 'Resposta crua da API pra reprocessar red flags depois se muda a lógica.';
COMMENT ON COLUMN dd_judit_consultas.credito_gasto IS 'Créditos consumidos do plano (ex: 4.25 pra consulta processual Adv).';

CREATE INDEX idx_dd_judit_operacao_created ON dd_judit_consultas(operacao_id, created_at DESC);
CREATE INDEX idx_dd_judit_status_erro      ON dd_judit_consultas(status) WHERE status <> 'ok';


-- ────────────────────────────────────────────────────────────────
-- 2. Colunas de cache em operacoes
-- ────────────────────────────────────────────────────────────────

ALTER TABLE operacoes
  ADD COLUMN dd_judit_ultima_id       uuid REFERENCES dd_judit_consultas(id) ON DELETE SET NULL,
  ADD COLUMN dd_judit_atualizado_em   timestamptz,
  ADD COLUMN dd_judit_red_flags       text[] DEFAULT ARRAY[]::text[];

COMMENT ON COLUMN operacoes.dd_judit_ultima_id     IS 'FK pra última consulta Judit desta operação. Evita join em queries de lista.';
COMMENT ON COLUMN operacoes.dd_judit_red_flags     IS 'Red flags extraídas do payload (ex: [\"penhora\", \"outro_cessionario\", \"regime_especial\"]). Renderizadas na UI como badges vermelhos.';


-- ────────────────────────────────────────────────────────────────
-- 3. Row Level Security (RLS)
-- ────────────────────────────────────────────────────────────────

ALTER TABLE dd_judit_consultas ENABLE ROW LEVEL SECURITY;

-- SELECT: herda visibilidade da operação (via EXISTS operacoes)
--   admin/gestao/juridico veem tudo; broker só se for dono da op
CREATE POLICY "dd_judit_select_via_operacao"
  ON dd_judit_consultas FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM operacoes o
      WHERE o.id = dd_judit_consultas.operacao_id
    )
  );

-- INSERT: apenas admin/gestao/juridico podem rodar consulta (broker não gasta crédito)
CREATE POLICY "dd_judit_insert_time_interno"
  ON dd_judit_consultas FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() IN ('admin', 'gestao', 'juridico')
    AND criado_por = auth.uid()
  );

-- DELETE: só admin (auditoria — normalmente não se apaga histórico)
CREATE POLICY "dd_judit_delete_admin"
  ON dd_judit_consultas FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');


-- ────────────────────────────────────────────────────────────────
-- 4. Função pra atualizar cache em operacoes após insert
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.atualizar_cache_dd_judit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só atualiza cache se a consulta foi bem sucedida
  IF NEW.status = 'ok' THEN
    UPDATE operacoes
    SET dd_judit_ultima_id     = NEW.id,
        dd_judit_atualizado_em = NEW.created_at
    WHERE id = NEW.operacao_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER dd_judit_atualizar_cache
  AFTER INSERT ON dd_judit_consultas
  FOR EACH ROW EXECUTE PROCEDURE public.atualizar_cache_dd_judit();

COMMENT ON FUNCTION public.atualizar_cache_dd_judit IS 'Após INSERT bem-sucedido em dd_judit_consultas, atualiza cache em operacoes.dd_judit_ultima_id / dd_judit_atualizado_em. Red flags são setadas pelo server action, não pelo trigger (lógica de negócio fica no app).';
