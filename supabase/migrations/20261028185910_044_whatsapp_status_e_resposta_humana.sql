-- =============================================================================
-- 044_whatsapp_status_e_resposta_humana.sql
--
-- Corrige a 043, que travou demais. Dois buracos apareceram ao desenhar a tela
-- de conversas do broker:
--
-- 1. A Meta informa entrega DEPOIS do envio (enviada → entregue → lida), por
--    webhook. Com UPDATE totalmente barrado, o status nunca sairia de
--    "enviando". O que é prova — quem disse o quê, quando — continua imutável;
--    só `status_entrega` muda, e `wa_message_id` pode ser preenchido UMA vez
--    (ele só existe depois que a Meta aceita a mensagem).
--
-- 2. Broker não tinha permissão de INSERT. A resposta dele é gravada ANTES de
--    ir pra Meta: se o envio falhar, o registro fica com status de falha, mas
--    fica. O contrário — gravar só depois — perderia a prova justamente quando
--    algo dá errado. O INSERT exige autor = quem está logado: ninguém grava
--    mensagem em nome de outro broker.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.whatsapp_mensagens_so_entrega_muda()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.id, NEW.conversa_id, NEW.direcao, NEW.autor, NEW.autor_id, NEW.tipo,
      NEW.conteudo, NEW.midia_id, NEW.template_nome, NEW.bruto, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.conversa_id, OLD.direcao, OLD.autor, OLD.autor_id, OLD.tipo,
      OLD.conteudo, OLD.midia_id, OLD.template_nome, OLD.bruto, OLD.created_at)
  THEN
    RAISE EXCEPTION
      'whatsapp_mensagens: só o status de entrega pode mudar. O conteúdo é a prova do que foi dito.';
  END IF;

  IF OLD.wa_message_id IS NOT NULL AND NEW.wa_message_id IS DISTINCT FROM OLD.wa_message_id THEN
    RAISE EXCEPTION
      'whatsapp_mensagens: wa_message_id já preenchido não muda.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER whatsapp_mensagens_sem_update ON public.whatsapp_mensagens;

CREATE TRIGGER whatsapp_mensagens_so_entrega_muda
  BEFORE UPDATE ON public.whatsapp_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_mensagens_so_entrega_muda();

-- Resposta humana. wa_message_id IS NULL: o id da Meta só quem preenche é o
-- servidor, depois que a Meta aceitou — senão dava pra forjar um envio.
CREATE POLICY whatsapp_mensagens_insert_humano ON public.whatsapp_mensagens
  FOR INSERT WITH CHECK (
    autor = 'humano'
    AND direcao = 'saida'
    AND autor_id = auth.uid()
    AND wa_message_id IS NULL
    AND (
      get_user_role() = ANY (ARRAY['admin', 'gestao'])
      OR (
        get_user_role() = 'broker'
        AND conversa_id IN (
          SELECT c.id FROM public.whatsapp_conversas c
          JOIN public.leads l ON l.id = c.lead_id
          WHERE l.dono_id = auth.uid()
        )
      )
    )
  );

COMMENT ON TABLE public.whatsapp_mensagens IS
  'Append-only no conteúdo. DELETE barrado; UPDATE só em status_entrega e no preenchimento único de wa_message_id. Vale inclusive para service role.';
