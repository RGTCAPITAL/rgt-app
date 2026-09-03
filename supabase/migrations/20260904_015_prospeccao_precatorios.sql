-- =============================================================================
-- 015_prospeccao_precatorios.sql
--
-- Fila de prospecção pré-lead. Fluxo:
--   planilha pública (TRT/TJ) → import batch → prospeccao_precatorios (importado)
--   → Judit enriquece → 'enriquecido' com nome do credor + advogado + red flags
--   → broker busca contato (LinkedIn, cartório) → cria lead formal → 'lead_criado'
--   → ou descarta com motivo → 'descartado'
--
-- Motivo de existir separado de leads:
--   leads exige nome. Aqui só temos CNJ + valor até a Judit rodar.
--   Depois vira lead com nome real + telefone.
--
-- Issue: RGT-XX (prospecção em massa)
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Tabela prospeccao_precatorios
-- ────────────────────────────────────────────────────────────────

CREATE TABLE prospeccao_precatorios (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dados da planilha oficial
  numero_processo          text          NOT NULL,
  numero_precatorio        text,
  numero_rp                text,
  tribunal                 text          NOT NULL,      -- 'TRT19', 'TJAL', 'TRF5'
  esfera                   text,                        -- 'Estadual', 'Federal', 'Municipal'
  ente_devedor_nome        text,                        -- 'ALAGOAS', 'SERVEAL' (não tem FK aqui, só texto)
  natureza_credito         text,                        -- 'Alimentar', 'Comum'
  tipo_requisicao          text,                        -- 'Precatório', 'RPV'
  valor_face               numeric(14,2),
  autuacao_data            date,
  vencimento_ano           int,
  vara_origem              text,
  fonte_lote               text          NOT NULL,      -- 'trt19_venc_2027' pra rastrear lote

  -- Enriquecimento via Judit (preenchido pelo batch)
  judit_status             text          NOT NULL DEFAULT 'pendente'
                                         CHECK (judit_status IN ('pendente','ok','not_found','error','skipped')),
  judit_ultima_consulta_id uuid          REFERENCES dd_judit_consultas(id) ON DELETE SET NULL,
  judit_enriquecido_em     timestamptz,
  cedente_nome_provavel    text,
  cedente_cpf_provavel     text,
  advogado_nome            text,
  advogado_oab             text,
  red_flags                text[]        NOT NULL DEFAULT ARRAY[]::text[],

  -- Status de prospecção
  status                   text          NOT NULL DEFAULT 'importado'
                                         CHECK (status IN ('importado','enriquecido','em_prospeccao','lead_criado','descartado')),
  lead_id                  uuid          REFERENCES leads(id) ON DELETE SET NULL,
  responsavel_id           uuid          REFERENCES usuarios(id) ON DELETE SET NULL,
  descartado_motivo        text,
  descartado_em            timestamptz,

  -- Metadados
  criado_por               uuid          REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now(),

  -- Coerência
  CONSTRAINT prospeccao_lead_com_id CHECK (
    status != 'lead_criado' OR lead_id IS NOT NULL
  ),
  CONSTRAINT prospeccao_descartado_com_motivo CHECK (
    status != 'descartado' OR descartado_motivo IS NOT NULL
  ),
  CONSTRAINT prospeccao_unique_por_lote UNIQUE (numero_processo, fonte_lote)
);

COMMENT ON TABLE  prospeccao_precatorios          IS 'Fila pré-lead: lista bruta de precatórios pra prospectar. Vira lead quando broker acha o contato.';
COMMENT ON COLUMN prospeccao_precatorios.fonte_lote IS 'Identifica o lote de origem (ex: trt19_venc_2027). Permite re-importar sem duplicar via UNIQUE.';
COMMENT ON COLUMN prospeccao_precatorios.judit_status IS 'Estado do enriquecimento Judit. pendente = ainda não rodou; skipped = optamos por não rodar.';
COMMENT ON COLUMN prospeccao_precatorios.responsavel_id IS 'Broker que assumiu essa prospecção. Vazio = na fila livre.';

CREATE INDEX idx_prospeccao_status              ON prospeccao_precatorios(status);
CREATE INDEX idx_prospeccao_judit_status        ON prospeccao_precatorios(judit_status);
CREATE INDEX idx_prospeccao_fonte_lote          ON prospeccao_precatorios(fonte_lote);
CREATE INDEX idx_prospeccao_valor_face_desc     ON prospeccao_precatorios(valor_face DESC NULLS LAST);
CREATE INDEX idx_prospeccao_responsavel         ON prospeccao_precatorios(responsavel_id) WHERE responsavel_id IS NOT NULL;
CREATE INDEX idx_prospeccao_lead_id             ON prospeccao_precatorios(lead_id) WHERE lead_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────────
-- 2. Trigger updated_at
-- ────────────────────────────────────────────────────────────────

CREATE TRIGGER prospeccao_precatorios_set_updated_at
  BEFORE UPDATE ON prospeccao_precatorios
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


-- ────────────────────────────────────────────────────────────────
-- 3. Row Level Security
-- ────────────────────────────────────────────────────────────────

ALTER TABLE prospeccao_precatorios ENABLE ROW LEVEL SECURITY;

-- SELECT: admin/gestao/broker/juridico veem tudo (fila compartilhada; juridico pode consultar em DD)
CREATE POLICY "prospeccao_select_todos_operacionais"
  ON prospeccao_precatorios FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin','gestao','broker','juridico'));

-- INSERT: só admin/gestao (importação de lote é ação administrativa)
CREATE POLICY "prospeccao_insert_admin_gestao"
  ON prospeccao_precatorios FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin','gestao'));

-- UPDATE: admin/gestao/broker (broker pega da fila, marca status, descarta)
CREATE POLICY "prospeccao_update_operacionais"
  ON prospeccao_precatorios FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin','gestao','broker'))
  WITH CHECK (public.get_user_role() IN ('admin','gestao','broker'));

-- DELETE: só admin (pra caso lote errado)
CREATE POLICY "prospeccao_delete_admin"
  ON prospeccao_precatorios FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');
