-- =============================================================================
-- 036_operacoes_campos_precificacao.sql
--
-- A tela de precificação precisa de três coisas que a operação não guardava.
-- Todas vieram de ver documento e plataforma reais, não de suposição.
--
-- 1. indice_correcao — o ofício requisitório DIZ qual índice aplicar. No
--    precatório 0502141-84.2025.8.02.9003 do TJAL o campo é literal:
--    "Índice de correção monetária: Selic". Assumir IPCA pra todo mundo
--    produziria valor errado, e a diferença entre Selic e IPCA em 31 meses
--    passa de 15 pontos percentuais.
--
-- 2. pss_valor — o ofício entrega o PSS em REAIS ("Valor da Previdência
--    Social: 57.596,17"), não em percentual. O sistema só tinha pss_pct, o
--    que obrigava a pessoa a calcular de cabeça o que o documento já dá
--    pronto — e a errar quando a alíquota do ente não é a padrão.
--
-- 3. atualizar_valores_ate — precificar sempre "até hoje" impede fazer
--    proposta com validade e impede refazer uma conta antiga do jeito que ela
--    foi feita. A Lajedo tem esse campo configurável na operação.
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Contexto: RGT-OS/knowledge/lajedo-plataforma-interna-2026-10-19.md
-- Depende de: 002 (operacoes), 021 (serie_indice)
-- =============================================================================

ALTER TABLE operacoes
  ADD COLUMN indice_correcao        serie_indice,
  ADD COLUMN pss_valor              numeric(14,2),
  ADD COLUMN atualizar_valores_ate  date;

COMMENT ON COLUMN operacoes.indice_correcao IS
  'Índice que o ofício requisitório manda aplicar a partir da data-base. Vem do campo "Índice de correção monetária" do documento. NULL = não informado, e a tela bloqueia o cálculo em vez de chutar.';
COMMENT ON COLUMN operacoes.pss_valor IS
  'Valor do PSS em reais, como o ofício entrega. Tem precedência sobre pss_pct: o documento é mais confiável que um percentual digitado.';
COMMENT ON COLUMN operacoes.atualizar_valores_ate IS
  'Data até a qual corrigir os valores. NULL significa hoje. Preenchido quando a proposta tem data de referência própria.';

-- Correção para data futura não existe: índice futuro não foi publicado.
ALTER TABLE operacoes
  ADD CONSTRAINT operacoes_atualizar_ate_nao_futura
  CHECK (atualizar_valores_ate IS NULL OR atualizar_valores_ate <= CURRENT_DATE);

ALTER TABLE operacoes
  ADD CONSTRAINT operacoes_pss_valor_nao_negativo
  CHECK (pss_valor IS NULL OR pss_valor >= 0);

-- A data de atualização nunca pode ser anterior à data-base: corrigir para
-- trás não é correção, é desconto.
ALTER TABLE operacoes
  ADD CONSTRAINT operacoes_atualizar_ate_apos_data_base
  CHECK (
    atualizar_valores_ate IS NULL
    OR data_base IS NULL
    OR atualizar_valores_ate >= data_base
  );
