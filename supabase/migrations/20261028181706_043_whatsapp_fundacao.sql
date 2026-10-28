-- =============================================================================
-- 043_whatsapp_fundacao.sql
--
-- As três tabelas do robô de WhatsApp (RGT-42), desenhadas em
-- knowledge/bot-whatsapp-pesquisa-2026-09-23.md.
--
-- Por que append-only de verdade, e não só RLS: o webhook da Meta escreve com
-- service role, que PASSA POR CIMA de RLS. Se a proteção do log fosse só
-- policy, um bug no handler apagaria a prova. Então UPDATE e DELETE em
-- whatsapp_mensagens e whatsapp_optout são barrados por TRIGGER, que vale pra
-- todo mundo, inclusive service role.
--
-- A separação por broker não é desenho novo: a conversa pendura no lead, e
-- leads já tem dono_id com RLS. Broker enxerga a conversa de quem é lead dele.
-- =============================================================================

-- Estado da conversa com uma pessoa. Uma linha por lead.
CREATE TABLE public.whatsapp_conversas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid REFERENCES public.leads(id) ON DELETE SET NULL,

  -- Telefone em dígitos, com DDI. É a chave real da conversa: mensagem chega
  -- por número, e pode chegar antes de existir lead (alguém viu o Instagram).
  telefone        text NOT NULL,
  -- Identificador que a Meta usa pro contato. Pode diferir do telefone.
  wa_id           text,
  nome_perfil     text,

  -- Depois de 24h sem mensagem da pessoa, o WhatsApp só aceita modelo
  -- aprovado. A tela precisa mostrar quanto falta, senão o broker descobre
  -- que não pode responder na hora em que tenta.
  janela_expira_em timestamptz,

  -- Quando um gatilho dispara, o robô para e não volta sozinho.
  bot_pausado     boolean NOT NULL DEFAULT false,
  pausado_motivo  text,
  pausado_em      timestamptz,

  -- Quem decidiu abordar esta pessoa. No contato frio é a prova de que houve
  -- decisão humana — disparo em lote é o padrão que a Meta pune.
  disparado_por_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,

  roteiro         text,
  status          text NOT NULL DEFAULT 'aberta',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT whatsapp_conversas_telefone_unico UNIQUE (telefone),
  CONSTRAINT whatsapp_conversas_status_valido
    CHECK (status IN ('aberta', 'aguardando_humano', 'encerrada')),
  CONSTRAINT whatsapp_conversas_telefone_digitos
    CHECK (telefone ~ '^[0-9]{10,15}$')
);

CREATE INDEX whatsapp_conversas_lead_idx ON public.whatsapp_conversas(lead_id);
CREATE INDEX whatsapp_conversas_pausado_idx
  ON public.whatsapp_conversas(bot_pausado) WHERE bot_pausado;

-- Log de tudo que entrou e saiu. É a prova da RGT se alguém reclamar.
CREATE TABLE public.whatsapp_mensagens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id   uuid NOT NULL REFERENCES public.whatsapp_conversas(id) ON DELETE RESTRICT,

  -- Id da mensagem na Meta. UNIQUE porque a Meta reenvia webhook em falha:
  -- sem isso, a mesma mensagem vira duas e o robô responde duas vezes.
  wa_message_id text UNIQUE,

  direcao       text NOT NULL,
  -- Quem escreveu. 'bot' e 'humano' saem da RGT; 'contato' é a pessoa.
  autor         text NOT NULL,
  -- Preenchido só quando autor = 'humano'. É o nome que assina a mensagem.
  autor_id      uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,

  tipo          text NOT NULL DEFAULT 'texto',
  conteudo      text,
  -- Áudio e imagem não viram texto aqui; guardamos a referência da Meta.
  midia_id      text,
  template_nome text,

  status_entrega text,
  -- Payload cru da Meta, pra reprocessar e pra auditoria.
  bruto         jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT whatsapp_mensagens_direcao_valida CHECK (direcao IN ('entrada', 'saida')),
  CONSTRAINT whatsapp_mensagens_autor_valido CHECK (autor IN ('bot', 'humano', 'contato')),
  CONSTRAINT whatsapp_mensagens_autor_id_coerente
    CHECK ((autor = 'humano') = (autor_id IS NOT NULL))
);

CREATE INDEX whatsapp_mensagens_conversa_idx
  ON public.whatsapp_mensagens(conversa_id, created_at DESC);

-- Quem pediu pra não ser mais contatado. Vale pra sempre, e vale também pro
-- broker humano — não é só o robô que para.
CREATE TABLE public.whatsapp_optout (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone    text NOT NULL UNIQUE,
  motivo      text,
  -- 'contato' = a pessoa pediu; 'rgt' = decisão interna.
  origem      text NOT NULL DEFAULT 'contato',
  registrado_por_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT whatsapp_optout_origem_valida CHECK (origem IN ('contato', 'rgt')),
  CONSTRAINT whatsapp_optout_telefone_digitos CHECK (telefone ~ '^[0-9]{10,15}$')
);

-- -----------------------------------------------------------------------------
-- Append-only por trigger. RLS não basta: service role passa por cima dela.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bloquear_alteracao_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'A tabela % é append-only: % não é permitido. Ela é a prova do que foi dito e para quem.',
    TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER whatsapp_mensagens_sem_update
  BEFORE UPDATE ON public.whatsapp_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_alteracao_append_only();

CREATE TRIGGER whatsapp_mensagens_sem_delete
  BEFORE DELETE ON public.whatsapp_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_alteracao_append_only();

CREATE TRIGGER whatsapp_optout_sem_delete
  BEFORE DELETE ON public.whatsapp_optout
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_alteracao_append_only();

-- updated_at só na tabela que muda de verdade.
CREATE TRIGGER whatsapp_conversas_updated_at
  BEFORE UPDATE ON public.whatsapp_conversas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: broker vê a conversa de quem é lead dele. Mesma regra de leads.
-- -----------------------------------------------------------------------------
ALTER TABLE public.whatsapp_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_optout    ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_conversas_select_admin_gestao ON public.whatsapp_conversas
  FOR SELECT USING (get_user_role() = ANY (ARRAY['admin', 'gestao']));

CREATE POLICY whatsapp_conversas_select_broker_proprias ON public.whatsapp_conversas
  FOR SELECT USING (
    get_user_role() = 'broker'
    AND lead_id IN (SELECT id FROM public.leads WHERE dono_id = auth.uid())
  );

CREATE POLICY whatsapp_conversas_update_admin_gestao ON public.whatsapp_conversas
  FOR UPDATE USING (get_user_role() = ANY (ARRAY['admin', 'gestao']));

CREATE POLICY whatsapp_conversas_update_broker_proprias ON public.whatsapp_conversas
  FOR UPDATE USING (
    get_user_role() = 'broker'
    AND lead_id IN (SELECT id FROM public.leads WHERE dono_id = auth.uid())
  );

CREATE POLICY whatsapp_mensagens_select_admin_gestao ON public.whatsapp_mensagens
  FOR SELECT USING (get_user_role() = ANY (ARRAY['admin', 'gestao']));

CREATE POLICY whatsapp_mensagens_select_broker_proprias ON public.whatsapp_mensagens
  FOR SELECT USING (
    get_user_role() = 'broker'
    AND conversa_id IN (
      SELECT c.id FROM public.whatsapp_conversas c
      JOIN public.leads l ON l.id = c.lead_id
      WHERE l.dono_id = auth.uid()
    )
  );

-- Opt-out é legível por todo mundo autenticado de propósito: a checagem de
-- "pode mandar?" tem que funcionar pra qualquer perfil, inclusive broker
-- olhando lead que não é dele.
CREATE POLICY whatsapp_optout_select_autenticado ON public.whatsapp_optout
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY whatsapp_optout_insert_equipe ON public.whatsapp_optout
  FOR INSERT WITH CHECK (get_user_role() = ANY (ARRAY['admin', 'gestao', 'broker']));

COMMENT ON TABLE public.whatsapp_mensagens IS
  'Append-only. UPDATE e DELETE barrados por trigger, inclusive para service role.';
COMMENT ON TABLE public.whatsapp_optout IS
  'Append-only no DELETE: quem pediu pra sair, saiu para sempre — vale também para o broker humano.';
COMMENT ON COLUMN public.whatsapp_conversas.janela_expira_em IS
  'Fim das 24h em que o WhatsApp aceita texto livre. Depois disso, só modelo aprovado.';
