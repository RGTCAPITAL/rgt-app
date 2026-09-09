-- =============================================================================
-- 009_notificacoes.sql
--
-- Tabela notificacoes + triggers de comentario / etapa / aceite.
-- Aplicar via: Supabase MCP (apply_migration)
-- Issue: RGT-51
--
-- Depende de: 001 (usuarios), 002 (operacoes), 003 (comentarios)
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Tabela
-- ────────────────────────────────────────────────────────────────

CREATE TABLE notificacoes (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  destinatario  uuid          NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo          text          NOT NULL CHECK (tipo IN ('comentario_novo', 'etapa_mudou', 'aceite_registrado')),
  titulo        text          NOT NULL,
  descricao     text,
  link          text,
  lida_em       timestamptz,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_notificacoes_destinatario_nao_lidas
  ON notificacoes(destinatario, created_at DESC) WHERE lida_em IS NULL;
CREATE INDEX idx_notificacoes_destinatario_recentes
  ON notificacoes(destinatario, created_at DESC);


-- ────────────────────────────────────────────────────────────────
-- 2. RLS
-- ────────────────────────────────────────────────────────────────

ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;

-- SELECT: só próprio destinatário
CREATE POLICY "notificacoes_select_self"
  ON notificacoes FOR SELECT
  TO authenticated
  USING (destinatario = auth.uid());

-- UPDATE: só destinatário (marcar como lida — só campo lida_em faz sentido)
CREATE POLICY "notificacoes_update_self"
  ON notificacoes FOR UPDATE
  TO authenticated
  USING (destinatario = auth.uid())
  WITH CHECK (destinatario = auth.uid());

-- DELETE: destinatário ou admin
CREATE POLICY "notificacoes_delete_self_ou_admin"
  ON notificacoes FOR DELETE
  TO authenticated
  USING (destinatario = auth.uid() OR public.get_user_role() = 'admin');

-- INSERT: nenhuma policy → só triggers SECURITY DEFINER conseguem inserir


-- ────────────────────────────────────────────────────────────────
-- 3. Helper: gera notificações pra dono + gestores/admins
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notificar_dono_e_gestao(
  p_operacao_id uuid,
  p_tipo text,
  p_titulo text,
  p_descricao text,
  p_link text,
  p_ator_id uuid  -- quem causou o evento (não recebe própria notif)
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dono_id uuid;
BEGIN
  SELECT o.dono_id INTO dono_id FROM public.operacoes o WHERE o.id = p_operacao_id;

  -- Notifica dono (se diferente do ator)
  IF dono_id IS NOT NULL AND dono_id IS DISTINCT FROM p_ator_id THEN
    INSERT INTO public.notificacoes (destinatario, tipo, titulo, descricao, link)
    VALUES (dono_id, p_tipo, p_titulo, p_descricao, p_link);
  END IF;

  -- Notifica admins e gestores (exceto ator e dono, pra evitar duplicata)
  INSERT INTO public.notificacoes (destinatario, tipo, titulo, descricao, link)
  SELECT u.id, p_tipo, p_titulo, p_descricao, p_link
  FROM public.usuarios u
  JOIN public.perfis p ON p.id = u.perfil_id
  WHERE p.slug IN ('admin', 'gestao')
    AND u.ativo = true
    AND u.id IS DISTINCT FROM p_ator_id
    AND u.id IS DISTINCT FROM dono_id;
END;
$$;


-- ────────────────────────────────────────────────────────────────
-- 4. Trigger: comentário novo
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notif_comentario_novo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  autor_nome text;
  op_numero text;
  trecho text;
BEGIN
  SELECT COALESCE(u.nome, u.email) INTO autor_nome
    FROM public.usuarios u WHERE u.id = NEW.autor_id;
  SELECT o.numero_processo INTO op_numero
    FROM public.operacoes o WHERE o.id = NEW.operacao_id;

  trecho := substring(NEW.texto FROM 1 FOR 100);
  IF char_length(NEW.texto) > 100 THEN trecho := trecho || '…'; END IF;

  PERFORM public.notificar_dono_e_gestao(
    NEW.operacao_id,
    'comentario_novo',
    format('%s comentou em %s', COALESCE(autor_nome, 'Alguém'), COALESCE(op_numero, 'operação')),
    trecho,
    '/operacoes/' || NEW.operacao_id,
    NEW.autor_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER comentarios_notificar
  AFTER INSERT ON comentarios
  FOR EACH ROW EXECUTE PROCEDURE public.notif_comentario_novo();


-- ────────────────────────────────────────────────────────────────
-- 5. Trigger: mudança de etapa
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notif_etapa_mudou() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ator_nome text;
  ator_id uuid;
BEGIN
  IF OLD.etapa_atual IS NOT DISTINCT FROM NEW.etapa_atual THEN
    RETURN NEW;
  END IF;

  ator_id := auth.uid();
  SELECT COALESCE(u.nome, u.email) INTO ator_nome
    FROM public.usuarios u WHERE u.id = ator_id;

  PERFORM public.notificar_dono_e_gestao(
    NEW.id,
    'etapa_mudou',
    format('%s → %s',
      COALESCE(NEW.numero_processo, 'Operação'),
      NEW.etapa_atual::text
    ),
    format('%s moveu a operação de "%s" para "%s"',
      COALESCE(ator_nome, 'Alguém'),
      OLD.etapa_atual::text,
      NEW.etapa_atual::text
    ),
    '/operacoes/' || NEW.id,
    ator_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER operacoes_notificar_etapa
  AFTER UPDATE OF etapa_atual ON operacoes
  FOR EACH ROW EXECUTE PROCEDURE public.notif_etapa_mudou();


-- ────────────────────────────────────────────────────────────────
-- 6. Trigger: aceite registrado
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notif_aceite_registrado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ator_id uuid;
  ator_nome text;
  status_texto text;
BEGIN
  IF OLD.preco_aceito IS NOT DISTINCT FROM NEW.preco_aceito THEN
    RETURN NEW;
  END IF;

  IF NEW.preco_aceito IS NULL THEN
    RETURN NEW;
  END IF;

  ator_id := auth.uid();
  SELECT COALESCE(u.nome, u.email) INTO ator_nome
    FROM public.usuarios u WHERE u.id = ator_id;

  status_texto := CASE
    WHEN NEW.preco_aceito THEN 'aceitou o preço'
    ELSE 'recusou o preço'
  END;

  PERFORM public.notificar_dono_e_gestao(
    NEW.id,
    'aceite_registrado',
    format('Credor %s em %s',
      status_texto,
      COALESCE(NEW.numero_processo, 'operação')
    ),
    format('Registrado por %s', COALESCE(ator_nome, 'alguém')),
    '/operacoes/' || NEW.id,
    ator_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER operacoes_notificar_aceite
  AFTER UPDATE OF preco_aceito ON operacoes
  FOR EACH ROW EXECUTE PROCEDURE public.notif_aceite_registrado();
