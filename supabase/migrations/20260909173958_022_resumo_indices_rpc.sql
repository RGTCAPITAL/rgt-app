-- Resumo por série agregado no banco.
--
-- A tela antes puxava todas as linhas e agregava em JS, o que bateu no limite
-- default de 1000 linhas do PostgREST e mostrou números errados (1.000 de 2.521).
-- Agregar aqui é uma query só e não tem teto.

CREATE OR REPLACE FUNCTION public.resumo_indices_economicos()
RETURNS TABLE (
  serie                serie_indice,
  total                bigint,
  primeira_competencia date,
  ultima_competencia   date,
  ultimo_valor         numeric,
  tem_numero_indice    boolean,
  coletado_em          timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    i.serie,
    count(*)                              AS total,
    min(i.competencia)                    AS primeira_competencia,
    max(i.competencia)                    AS ultima_competencia,
    (array_agg(i.variacao_pct ORDER BY i.competencia DESC))[1] AS ultimo_valor,
    bool_or(i.numero_indice IS NOT NULL)  AS tem_numero_indice,
    max(i.coletado_em)                    AS coletado_em
  FROM indices_economicos i
  GROUP BY i.serie;
$$;

COMMENT ON FUNCTION public.resumo_indices_economicos() IS
  'Resumo por série para o painel admin. Agrega no banco pra não esbarrar no limite de linhas do PostgREST.';
