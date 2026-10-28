-- =============================================================================
-- 047_whatsapp_busca_por_chave_de_telefone.sql
--
-- O disparo (o broker escrevendo primeiro, com modelo aprovado) parte do
-- telefone da planilha, que tem o nono dígito. A Meta devolve e informa no
-- webhook o wa_id, que às vezes vem SEM ele. `whatsapp_conversas.telefone` e
-- `whatsapp_optout.telefone` guardam o wa_id — então o `.eq` com o telefone
-- da planilha não acha nada (visto pela sessão da Meta em 28/10):
--   - quem pediu pra sair receberia o modelo de novo;
--   - quem já conversou ganharia uma SEGUNDA conversa.
-- As duas funções comparam pela mesma chave do lead (DDD + 8 últimos dígitos,
-- migration 045). Só a rotina de disparo (service role) chama.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.conversa_por_telefone(p_telefone text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT id FROM whatsapp_conversas
  WHERE whatsapp_chave_telefone(telefone) = whatsapp_chave_telefone(p_telefone)
    AND whatsapp_chave_telefone(p_telefone) IS NOT NULL
  ORDER BY created_at
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.telefone_em_optout(p_telefone text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM whatsapp_optout
    WHERE whatsapp_chave_telefone(telefone) = whatsapp_chave_telefone(p_telefone)
      AND whatsapp_chave_telefone(p_telefone) IS NOT NULL
  )
$$;

REVOKE EXECUTE ON FUNCTION public.conversa_por_telefone(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.telefone_em_optout(text) FROM PUBLIC, anon, authenticated;
