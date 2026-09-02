-- =============================================================================
-- 010_leads.sql
--
-- Tabela de leads pré-venda (CRM). Fluxo:
--   lead → status muda no kanban → 'qualificado' →
--   admin/gestao/broker clica "Virar operação" → cria row em operacoes com
--   cedente pré-preenchido → lead.status = 'ganho' + lead.operacao_id populado.
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Issue: RGT-60 · Milestone: CRM básico (M3)
--
-- Depende de: 001 (usuarios), 002 (operacoes)
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Enums
-- ────────────────────────────────────────────────────────────────

CREATE TYPE origem_lead AS ENUM (
  'whatsapp',    -- captado pelo WhatsApp comercial
  'site',        -- form de contato de rgtcapital.com.br
  'indicacao',   -- boca a boca
  'linkedin',    -- outbound do Renato/comercial
  'evento',      -- feira, palestra, meetup
  'outro'
);

CREATE TYPE status_lead AS ENUM (
  'novo',                -- entrou no funil, ainda não teve contato
  'em_contato',          -- alguém falou com o lead
  'qualificado',         -- tem processo real, tem interesse, cabe no ICP
  'proposta_enviada',    -- preço proposto foi enviado, aguardando resposta
  'ganho',               -- virou operação (lead.operacao_id preenchido)
  'perdido'              -- fora do ICP, desistiu, ou lead frio
);


-- ────────────────────────────────────────────────────────────────
-- 2. Tabela leads
-- ────────────────────────────────────────────────────────────────

CREATE TABLE leads (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text          NOT NULL CHECK (char_length(nome) > 0),
  telefone      text,
  email         text,
  cpf_cnpj      text,
  origem        origem_lead   NOT NULL,
  status        status_lead   NOT NULL DEFAULT 'novo',
  dono_id       uuid                    REFERENCES usuarios(id) ON DELETE SET NULL,
  operacao_id   uuid          UNIQUE    REFERENCES operacoes(id) ON DELETE SET NULL,
  motivo_perda  text,
  notas         text,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),

  -- Coerência: perdido exige motivo_perda; ganho exige operacao_id
  CONSTRAINT leads_perdido_com_motivo CHECK (
    status != 'perdido' OR motivo_perda IS NOT NULL
  ),
  CONSTRAINT leads_ganho_com_operacao CHECK (
    status != 'ganho' OR operacao_id IS NOT NULL
  )
);

COMMENT ON TABLE  leads             IS 'Pipeline pré-venda. Vira operação em operacoes quando qualifica e cliente aceita a proposta.';
COMMENT ON COLUMN leads.operacao_id IS 'Preenchido quando lead vira operação. UNIQUE: uma operação não vem de dois leads.';
COMMENT ON COLUMN leads.dono_id     IS 'Quem trabalha esse lead. Broker vê só os próprios.';

CREATE INDEX idx_leads_status                 ON leads(status);
CREATE INDEX idx_leads_dono_id                ON leads(dono_id) WHERE dono_id IS NOT NULL;
CREATE INDEX idx_leads_created_at             ON leads(created_at DESC);
CREATE INDEX idx_leads_origem_status          ON leads(origem, status);


-- ────────────────────────────────────────────────────────────────
-- 3. Trigger updated_at (reutiliza set_updated_at() da 001)
-- ────────────────────────────────────────────────────────────────

CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


-- ────────────────────────────────────────────────────────────────
-- 4. Row Level Security (RLS)
-- ────────────────────────────────────────────────────────────────

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- SELECT: admin/gestao veem tudo; broker vê só os próprios; juridico não entra (fora do escopo pré-venda)
CREATE POLICY "leads_select_admin_gestao"
  ON leads FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin', 'gestao'));

CREATE POLICY "leads_select_broker_proprios"
  ON leads FOR SELECT TO authenticated
  USING (public.get_user_role() = 'broker' AND dono_id = auth.uid());

-- INSERT: admin/gestao cria pra qualquer dono; broker cria só pra si mesmo
CREATE POLICY "leads_insert_admin_gestao"
  ON leads FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'gestao'));

CREATE POLICY "leads_insert_broker"
  ON leads FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'broker' AND dono_id = auth.uid());

-- UPDATE: admin/gestao qualquer lead; broker só os próprios
CREATE POLICY "leads_update_admin_gestao"
  ON leads FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'gestao'))
  WITH CHECK (public.get_user_role() IN ('admin', 'gestao'));

CREATE POLICY "leads_update_broker_proprios"
  ON leads FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'broker' AND dono_id = auth.uid())
  WITH CHECK (public.get_user_role() = 'broker' AND dono_id = auth.uid());

-- DELETE: só admin
CREATE POLICY "leads_delete_admin"
  ON leads FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');
