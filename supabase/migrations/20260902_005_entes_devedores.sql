-- =============================================================================
-- 005_entes_devedores.sql
--
-- Cria tabela entes_devedores (quem paga o precatório) + seed inicial +
-- FK em operacoes.ente_devedor_id.
--
-- Aplicar em: Supabase MCP (apply_migration)
-- Issue: RGT-47
--
-- Depende de: 002_operacoes.sql (enum esfera_ativo), 004_operacoes_v2.sql
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Tabela entes_devedores
-- ────────────────────────────────────────────────────────────────

CREATE TABLE entes_devedores (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text          NOT NULL,
  esfera        esfera_ativo  NOT NULL,
  uf            text          CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$'),  -- só pra estadual/municipal
  ativo         boolean       NOT NULL DEFAULT true,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (nome, esfera)
);

COMMENT ON TABLE  entes_devedores IS
  'Entes públicos devedores de precatórios (União, autarquias federais, estados, municípios). Dropdown na tela de cadastro puxa daqui.';
COMMENT ON COLUMN entes_devedores.ativo IS
  'Desativa (não deleta) pra preservar histórico de operações que referenciam esse ente.';

CREATE INDEX idx_entes_devedores_esfera_ativo ON entes_devedores(esfera, ativo);
CREATE INDEX idx_entes_devedores_uf ON entes_devedores(uf) WHERE uf IS NOT NULL;


-- ────────────────────────────────────────────────────────────────
-- 2. RLS
-- ────────────────────────────────────────────────────────────────

ALTER TABLE entes_devedores ENABLE ROW LEVEL SECURITY;

-- Qualquer autenticado pode ler (dropdown de cadastro)
CREATE POLICY "entes_devedores_select_authenticated"
  ON entes_devedores FOR SELECT
  TO authenticated
  USING (true);

-- Só admin pode INSERT/UPDATE/DELETE
CREATE POLICY "entes_devedores_admin_all"
  ON entes_devedores FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');


-- ────────────────────────────────────────────────────────────────
-- 3. Seed inicial (colhido do Lajedo + adicionais comuns AL/PE)
-- ────────────────────────────────────────────────────────────────

-- FEDERAIS (União + autarquias/fundações/empresas públicas comuns)
INSERT INTO entes_devedores (nome, esfera) VALUES
  ('União',                                                          'federal'),
  ('INSS - Instituto Nacional do Seguro Social',                     'federal'),
  ('Empresa Brasileira de Pesquisa Agropecuária (EMBRAPA)',          'federal'),
  ('Empresa Brasileira de Correios e Telégrafos (ECT)',              'federal'),
  ('Caixa Econômica Federal',                                        'federal'),
  ('Banco do Brasil',                                                'federal'),
  ('Universidade Federal de Alagoas (UFAL)',                         'federal'),
  ('Universidade Federal de Pernambuco (UFPE)',                      'federal'),
  ('Universidade Federal Rural de Pernambuco (UFRPE)',               'federal'),
  ('Universidade Federal do Maranhão (UFMA)',                        'federal'),
  ('Instituto Federal de Alagoas (IFAL)',                            'federal'),
  ('Instituto Federal de Pernambuco (IFPE)',                         'federal'),
  ('Fundação Nacional de Saúde (FUNASA)',                            'federal'),
  ('Fundação Oswaldo Cruz (FIOCRUZ)',                                'federal'),
  ('Agência Nacional de Energia Elétrica (ANEEL)',                   'federal');

-- ESTADUAIS (Alagoas + Pernambuco — foco de operação da RGT)
INSERT INTO entes_devedores (nome, esfera, uf) VALUES
  ('Estado de Alagoas',                                              'estadual', 'AL'),
  ('Estado de Pernambuco',                                           'estadual', 'PE'),
  ('Universidade Estadual de Alagoas (UNEAL)',                       'estadual', 'AL'),
  ('Universidade de Pernambuco (UPE)',                               'estadual', 'PE'),
  ('Defensoria Pública do Estado de Alagoas (DPE-AL)',               'estadual', 'AL'),
  ('Defensoria Pública do Estado de Pernambuco (DPE-PE)',            'estadual', 'PE');


-- ────────────────────────────────────────────────────────────────
-- 4. Adicionar coluna ente_devedor_id em operacoes
--    Nullable por enquanto — deixa flexível pra operações antigas
--    (quando UI estiver pronta pra selecionar, torna NOT NULL)
-- ────────────────────────────────────────────────────────────────

ALTER TABLE operacoes
  ADD COLUMN ente_devedor_id uuid REFERENCES entes_devedores(id) ON DELETE SET NULL;

CREATE INDEX idx_operacoes_ente_devedor_id ON operacoes(ente_devedor_id) WHERE ente_devedor_id IS NOT NULL;

COMMENT ON COLUMN operacoes.ente_devedor_id IS
  'FK pra entes_devedores. Nullable durante transição — deve virar NOT NULL quando UI de cadastro estiver pronta (RGT-17).';
