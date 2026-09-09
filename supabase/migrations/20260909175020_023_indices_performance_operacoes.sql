-- ============================================================================
-- 023: índices que faltavam em operacoes + agregação do pipeline
--
-- ONDA 2 da auditoria (RGT-75).
--
-- P5: `.order('updated_at')` aparece na lista de operações e 4x no dashboard
--     admin; `.eq('preco_aceito', true)` no resumo financeiro. Sem índice, os
--     dois viram Seq Scan + Sort a partir de poucos milhares de linhas.
-- P6: o dashboard puxava id+valor_total de TODAS as operações abertas só pra
--     somar no cliente. Com 10k operações isso é meio MB por acesso à home.
--     A soma passa a ser feita no banco.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_operacoes_updated_at
  ON operacoes(updated_at DESC);

-- Índice parcial: só as aceitas, que é o recorte usado no resumo financeiro
CREATE INDEX IF NOT EXISTS idx_operacoes_preco_aceito_true
  ON operacoes(id) WHERE preco_aceito = true;

COMMENT ON INDEX idx_operacoes_updated_at IS
  'Ordenação padrão da lista de operações e do dashboard.';
COMMENT ON INDEX idx_operacoes_preco_aceito_true IS
  'Parcial: recorte de operações aceitas usado no resumo financeiro.';


-- Totais do pipeline agregados no banco.
-- SECURITY INVOKER (padrão): a função roda com as permissões de quem chama,
-- então a RLS de operacoes continua valendo — um broker só soma o que ele vê.
CREATE OR REPLACE FUNCTION public.totais_pipeline()
RETURNS TABLE (
  abertas          bigint,
  valor_abertas    numeric,
  aceitas          bigint,
  valor_aceitas    numeric,
  finalizadas      bigint,
  valor_finalizadas numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    count(*) FILTER (WHERE etapa_atual NOT IN ('finalizada','cancelada')),
    COALESCE(sum(valor_total) FILTER (WHERE etapa_atual NOT IN ('finalizada','cancelada')), 0),
    count(*) FILTER (WHERE preco_aceito = true),
    COALESCE(sum(preco_proposto) FILTER (WHERE preco_aceito = true), 0),
    count(*) FILTER (WHERE etapa_atual = 'finalizada'),
    COALESCE(sum(valor_total) FILTER (WHERE etapa_atual = 'finalizada'), 0)
  FROM operacoes;
$$;

COMMENT ON FUNCTION public.totais_pipeline() IS
  'Totais do pipeline somados no banco em vez de transferir todas as linhas pro cliente. SECURITY INVOKER: respeita a RLS de quem chama.';
