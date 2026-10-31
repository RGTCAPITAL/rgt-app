-- =============================================================================
-- 049_mensagem_sabe_o_lead.sql
--
-- A conversa do WhatsApp é uma por telefone. Quando um advogado cuida de dois
-- credores, o modelo sobre o segundo cai na conversa que ficou com o primeiro
-- (whatsapp_conversas.lead_id), e a resposta do advogado não contava para o
-- segundo: o follow-up mandava insistir com quem já tinha respondido, e o lead
-- sem telefone próprio nem tinha follow-up.
--
-- O disparo passa a gravar na mensagem de qual lead ela trata. Daquela
-- mensagem em diante, a conversa também fala desse lead, e as respostas que
-- vierem depois contam para ele (lib/regras/executar.ts).
--
-- Nada antigo para preencher: até 31/10 nenhum modelo tinha saído.
-- =============================================================================

-- SET NULL, e não RESTRICT: a mensagem é a prova do que foi dito e fica. Se o
-- lead for apagado, some só o vínculo.
ALTER TABLE public.whatsapp_mensagens
  ADD COLUMN lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.whatsapp_mensagens.lead_id IS
  'Lead de que a mensagem enviada trata. O disparo de modelo grava; nunca muda depois (só some se o lead for apagado).';

-- As regras leem "modelos sobre estes leads"; o SET NULL do lead apagado
-- também procura por aqui. Quase toda mensagem fica sem lead: índice parcial.
CREATE INDEX whatsapp_mensagens_lead_idx
  ON public.whatsapp_mensagens(lead_id) WHERE lead_id IS NOT NULL;

-- O lead entra na lista do que não muda. Trocar o lead de uma mensagem já
-- enviada reescreveria de quem se falou; preencher depois, também. Só o
-- ON DELETE SET NULL passa (ele é um UPDATE e dispara este trigger).
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

  IF NEW.lead_id IS DISTINCT FROM OLD.lead_id AND NEW.lead_id IS NOT NULL THEN
    RAISE EXCEPTION
      'whatsapp_mensagens: o lead da mensagem não muda.';
  END IF;

  RETURN NEW;
END;
$$;

-- A resposta do broker pela tela de Conversas entra com a permissão dele e
-- não diz de qual lead trata. Sem esta trava, um INSERT direto pela API podia
-- apontar a conversa para o lead de outra pessoa e calar o follow-up dele. Só
-- o disparo, pelo servidor, grava o lead.
DROP POLICY whatsapp_mensagens_insert_humano ON public.whatsapp_mensagens;

CREATE POLICY whatsapp_mensagens_insert_humano ON public.whatsapp_mensagens
  FOR INSERT WITH CHECK (
    autor = 'humano'
    AND direcao = 'saida'
    AND autor_id = auth.uid()
    AND wa_message_id IS NULL
    AND lead_id IS NULL
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
  'Append-only no conteúdo. DELETE barrado; UPDATE só em status_entrega, no preenchimento único de wa_message_id e no lead_id que vira NULL quando o lead é apagado. Vale inclusive para service role.';
