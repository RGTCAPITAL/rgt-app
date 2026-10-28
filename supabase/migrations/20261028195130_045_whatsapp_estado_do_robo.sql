-- =============================================================================
-- 045_whatsapp_estado_do_robo.sql
--
-- O que o executor do robô precisa pra rodar fora do simulador.
--
-- 1. Estado entre mensagens. Cada mensagem que chega é uma chamada nova, sem
--    memória: quantas vezes o robô já recusou preço (a 2ª escala), quantas
--    seguidas ele não entendeu (a 2ª escala) e o que já foi confirmado. Sem
--    isso o freio de preço nunca escalaria.
--
-- 2. Achar o lead pelo telefone. Os leads guardam telefone em três formatos
--    (11 dígitos, 12 dígitos, com máscara), e a Meta às vezes manda número
--    brasileiro SEM o nono dígito. A chave compara DDD + últimos 8 dígitos,
--    que é o que sobra igual em todos os casos.
--
-- 3. Tipo 'whatsapp' na notificação, pra o sino distinguir de comentário.
-- =============================================================================

ALTER TABLE public.whatsapp_conversas
  ADD COLUMN recusas_preco    integer NOT NULL DEFAULT 0,
  ADD COLUMN nao_entendidas   integer NOT NULL DEFAULT 0,
  ADD COLUMN dados_coletados  jsonb;

COMMENT ON COLUMN public.whatsapp_conversas.dados_coletados IS
  'O que a pessoa confirmou ao robô (titularidade, interesse, estado civil...). Mostrado ao broker na conversa.';

CREATE OR REPLACE FUNCTION public.whatsapp_chave_telefone(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN length(n) IN (10, 11) THEN left(n, 2) || right(n, 8) END
  FROM (
    SELECT CASE WHEN length(d) IN (12, 13) AND left(d, 2) = '55' THEN substr(d, 3) ELSE d END AS n
    FROM (SELECT regexp_replace(coalesce(t, ''), '\D', '', 'g') AS d) a
  ) b
$$;

-- Lead mais recente com o mesmo telefone. Chamada pelo executor (service role).
CREATE OR REPLACE FUNCTION public.lead_por_telefone(p_telefone text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT id FROM leads
  WHERE whatsapp_chave_telefone(telefone) = whatsapp_chave_telefone(p_telefone)
    AND whatsapp_chave_telefone(p_telefone) IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.lead_por_telefone(text) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.notificacoes DROP CONSTRAINT notificacoes_tipo_check;
ALTER TABLE public.notificacoes ADD CONSTRAINT notificacoes_tipo_check
  CHECK (tipo = ANY (ARRAY['comentario_novo', 'etapa_mudou', 'aceite_registrado',
                           'tarefa_nova', 'ente_regime_especial', 'whatsapp']));
