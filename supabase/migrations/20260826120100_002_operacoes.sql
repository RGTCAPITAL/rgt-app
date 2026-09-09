-- =============================================================================
-- 002_operacoes.sql
--
-- Tabela central da P1: operações de precatório/RPV/direito creditório.
-- Aplicar em: SQL Editor do Supabase Dashboard
-- Data: 2026-08-26
-- Issue: RGT-12
--
-- Depende de: 001_perfis_usuarios.sql (tabela usuarios + função get_user_role)
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Enums do domínio
-- ────────────────────────────────────────────────────────────────

CREATE TYPE tipo_ativo AS ENUM (
  'precatorio',        -- tem ofício requisitório, valor > 60 salários mínimos
  'rpv',               -- Requisição de Pequeno Valor, paga em 60 dias
  'direito_creditorio' -- processo ainda não virou precatório, precisa decisão homologatória
);

CREATE TYPE esfera_ativo AS ENUM (
  'federal',
  'estadual',
  'municipal'  -- bloqueada por default (só admin pode cadastrar)
);

CREATE TYPE natureza_ativo AS ENUM (
  'alimentar',
  'comum',
  'tributaria'
);

CREATE TYPE especie_ativo AS ENUM (
  'credito_total',      -- servidor + advogado
  'contratual',
  'sucumbencial',
  'apenas_principal'    -- só a parte do servidor (advogado retido separado)
);

CREATE TYPE etapa_operacao AS ENUM (
  'precificacao',            -- calcular preço com fórmulas
  'aceite',                  -- credor aceita ou recusa
  'due_diligence_juridica',  -- Robson lê autos, dá parecer
  'due_diligence_fiscal',    -- coleta certidões, checa CPAG
  'analise_investimento',    -- Renato faz parecer de retorno
  'cartorio',                -- Zapsign, assinatura
  'pagamento',               -- transferência pro credor
  'finalizada',              -- operação concluída
  'cancelada'                -- não avançou (recusou, desistiu, inviabilizada)
);


-- ────────────────────────────────────────────────────────────────
-- 2. Tabela operacoes
-- ────────────────────────────────────────────────────────────────

CREATE TABLE operacoes (
  id                        uuid              PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificação do ativo
  numero_processo           text              NOT NULL,
  tipo                      tipo_ativo        NOT NULL,
  esfera                    esfera_ativo      NOT NULL,
  natureza                  natureza_ativo    NOT NULL,
  especie                   especie_ativo     NOT NULL,
  tribunal                  text              NOT NULL,

  -- Valores
  valor_total               numeric(18, 2)    NOT NULL CHECK (valor_total >= 0),
  valor_principal           numeric(18, 2)              CHECK (valor_principal IS NULL OR valor_principal >= 0),
  valor_juros               numeric(18, 2)              CHECK (valor_juros     IS NULL OR valor_juros     >= 0),
  valor_selic               numeric(18, 2)              CHECK (valor_selic     IS NULL OR valor_selic     >= 0),
  retencao_honorarios_pct   numeric(5, 2)     NOT NULL DEFAULT 0 CHECK (retencao_honorarios_pct BETWEEN 0 AND 100),

  -- Datas
  data_base                 date              NOT NULL,
  lua                       integer           NOT NULL CHECK (lua BETWEEN 2020 AND 2050),

  -- Credor (inline por simplicidade — refatorar pra tabela credores no futuro)
  credor_nome               text              NOT NULL,
  credor_cpf                text              NOT NULL CHECK (credor_cpf ~ '^[0-9]{11}$'),

  -- Precificação
  preco_proposto            numeric(18, 2)              CHECK (preco_proposto IS NULL OR preco_proposto >= 0),
  preco_aceito              boolean,          -- NULL = pendente, TRUE = aceito, FALSE = recusado

  -- Workflow
  etapa_atual               etapa_operacao    NOT NULL DEFAULT 'precificacao',

  -- Responsáveis
  dono_id                   uuid              NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  broker_id                 uuid                       REFERENCES usuarios(id) ON DELETE SET NULL,

  -- Extras
  observacoes               text,

  -- Timestamps
  created_at                timestamptz       NOT NULL DEFAULT now(),
  updated_at                timestamptz       NOT NULL DEFAULT now(),

  -- ── Constraints de coerência ─────────────────────────
  -- Direito creditório exige os 3 componentes preenchidos
  CONSTRAINT operacoes_componentes_direito_creditorio CHECK (
    tipo != 'direito_creditorio'
    OR (valor_principal IS NOT NULL AND valor_juros IS NOT NULL AND valor_selic IS NOT NULL)
  ),
  -- Se aceito, tem que ter preço proposto
  CONSTRAINT operacoes_aceite_precisa_preco CHECK (
    preco_aceito IS DISTINCT FROM true OR preco_proposto IS NOT NULL
  )
);

COMMENT ON TABLE operacoes IS
  'Operação central da P1: cada precatório/RPV/direito creditório em processo. Passa pelas etapas do workflow do cadastro ao pagamento.';

COMMENT ON COLUMN operacoes.credor_cpf IS
  '11 dígitos, sem pontuação. Formatação de display é responsabilidade do frontend.';

COMMENT ON COLUMN operacoes.lua IS
  'Ano estimado de pagamento (Lei Orçamentária Anual). Precatório com ofício = calculado auto; direito creditório = estimado.';

COMMENT ON COLUMN operacoes.preco_aceito IS
  'NULL = credor ainda não recebeu proposta ou não respondeu; TRUE = aceitou; FALSE = recusou.';


-- ────────────────────────────────────────────────────────────────
-- 3. Índices
-- ────────────────────────────────────────────────────────────────

CREATE INDEX idx_operacoes_dono_id       ON operacoes(dono_id);
CREATE INDEX idx_operacoes_broker_id     ON operacoes(broker_id) WHERE broker_id IS NOT NULL;
CREATE INDEX idx_operacoes_etapa_atual   ON operacoes(etapa_atual);
CREATE INDEX idx_operacoes_tribunal      ON operacoes(tribunal);
CREATE INDEX idx_operacoes_created_at    ON operacoes(created_at DESC);
CREATE INDEX idx_operacoes_credor_cpf    ON operacoes(credor_cpf);


-- ────────────────────────────────────────────────────────────────
-- 4. Trigger updated_at (reutiliza função set_updated_at() da 001)
-- ────────────────────────────────────────────────────────────────

CREATE TRIGGER operacoes_set_updated_at
  BEFORE UPDATE ON operacoes
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


-- ────────────────────────────────────────────────────────────────
-- 5. Trigger de esfera municipal bloqueada por default
--    (só permite se perfil do user tem flag `pode_esfera_municipal`)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_esfera_municipal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.esfera = 'municipal' THEN
    IF NOT EXISTS (
      SELECT 1 FROM usuarios u
      JOIN perfis p ON p.id = u.perfil_id
      WHERE u.id = auth.uid()
        AND (p.permissoes->>'pode_esfera_municipal')::boolean IS TRUE
    ) THEN
      RAISE EXCEPTION 'Esfera municipal está bloqueada. Só admin pode cadastrar operações de esfera municipal.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operacoes_check_esfera_municipal
  BEFORE INSERT OR UPDATE OF esfera ON operacoes
  FOR EACH ROW EXECUTE PROCEDURE public.check_esfera_municipal();


-- ────────────────────────────────────────────────────────────────
-- 6. Row Level Security (RLS)
-- ────────────────────────────────────────────────────────────────

ALTER TABLE operacoes ENABLE ROW LEVEL SECURITY;

-- SELECT: admin/gestao/juridico veem tudo; broker vê só as próprias
CREATE POLICY "operacoes_select_admin_gestao_juridico"
  ON operacoes FOR SELECT
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'gestao', 'juridico'));

CREATE POLICY "operacoes_select_broker_proprias"
  ON operacoes FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'broker'
    AND (broker_id = auth.uid() OR dono_id = auth.uid())
  );

-- INSERT: admin/gestao/broker podem cadastrar
--   Broker: broker_id ou dono_id deve ser ele mesmo
--   Jurídico: NÃO cadastra
CREATE POLICY "operacoes_insert_admin_gestao"
  ON operacoes FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'gestao'));

CREATE POLICY "operacoes_insert_broker"
  ON operacoes FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_user_role() = 'broker'
    AND (broker_id = auth.uid() OR dono_id = auth.uid())
  );

-- UPDATE: admin/gestao qualquer; juridico qualquer (pra editar campos jurídicos); broker só as suas
CREATE POLICY "operacoes_update_admin_gestao_juridico"
  ON operacoes FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'gestao', 'juridico'))
  WITH CHECK (public.get_user_role() IN ('admin', 'gestao', 'juridico'));

CREATE POLICY "operacoes_update_broker_proprias"
  ON operacoes FOR UPDATE
  TO authenticated
  USING (
    public.get_user_role() = 'broker'
    AND (broker_id = auth.uid() OR dono_id = auth.uid())
  )
  WITH CHECK (
    public.get_user_role() = 'broker'
    AND (broker_id = auth.uid() OR dono_id = auth.uid())
  );

-- DELETE: só admin
CREATE POLICY "operacoes_delete_admin"
  ON operacoes FOR DELETE
  TO authenticated
  USING (public.get_user_role() = 'admin');
