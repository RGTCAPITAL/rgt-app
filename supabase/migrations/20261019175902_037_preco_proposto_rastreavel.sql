-- =============================================================================
-- 037_preco_proposto_rastreavel.sql
--
-- Hoje não existe forma de salvar um preço sem declarar que o credor aceitou:
-- `registrarAceite` só roda na etapa de aceite e sempre grava `preco_aceito`
-- no mesmo update. Na prática o advogado precifica, manda a proposta e espera
-- dias pela resposta — e o sistema o obriga a afirmar um aceite que ainda não
-- houve, ou a não guardar o número.
--
-- A constraint do banco nunca impediu isso (ela só exige preço QUANDO há
-- aceite). O bloqueio estava na camada de aplicação.
--
-- Estes campos existem porque preço é dinheiro: precisa saber quem pôs,
-- quando, e por quê. Sem tabela nova — enquanto só interessa o preço vigente,
-- três colunas resolvem. Se um dia for preciso o histórico completo de
-- negociação, aí sim nasce `precificacoes` append-only.
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Depende de: 002 (operacoes), 001 (usuarios)
-- =============================================================================

ALTER TABLE operacoes
  ADD COLUMN preco_proposto_em    timestamptz,
  ADD COLUMN preco_proposto_por   uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN preco_justificativa  text;

COMMENT ON COLUMN operacoes.preco_proposto_em IS
  'Quando o preço vigente foi definido. Distinto de updated_at, que muda por qualquer alteração.';
COMMENT ON COLUMN operacoes.preco_proposto_por IS
  'Quem definiu o preço vigente. Preço é dinheiro — precisa ter dono.';
COMMENT ON COLUMN operacoes.preco_justificativa IS
  'Por que esse preço. Relevante quando foge da régua: risco do ente, pressa do credor, negociação.';

-- Preço registrado sem autor ou sem data é rastro pela metade: ou tem os três
-- (valor, quem, quando) ou não tem nenhum.
ALTER TABLE operacoes
  ADD CONSTRAINT operacoes_preco_rastro_completo CHECK (
    preco_proposto IS NULL
    OR (preco_proposto_em IS NOT NULL AND preco_proposto_por IS NOT NULL)
    -- Operações anteriores a esta migration têm preço sem rastro; a cláusula
    -- abaixo as mantém válidas até alguém salvar um preço novo por cima.
    OR (preco_proposto_em IS NULL AND preco_proposto_por IS NULL)
  );

CREATE INDEX idx_operacoes_preco_proposto_em
  ON operacoes (preco_proposto_em DESC)
  WHERE preco_proposto_em IS NOT NULL;
