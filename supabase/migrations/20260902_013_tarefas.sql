-- =============================================================================
-- 013_tarefas.sql
--
-- Central de Tarefas broker↔time interno. Cada tarefa: título, descrição,
-- destinatário (por perfil ou pessoa específica), prazo, status.
-- Diferente de comentários (conversa livre) — tarefa é AÇÃO estruturada.
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Issue: RGT-49
-- =============================================================================

CREATE TABLE tarefas (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  operacao_id           uuid          NOT NULL REFERENCES operacoes(id) ON DELETE CASCADE,
  titulo                text          NOT NULL CHECK (char_length(titulo) > 0),
  descricao             text,
  criado_por_id         uuid                    REFERENCES usuarios(id) ON DELETE SET NULL,
  destinatario_perfil   text          CHECK (destinatario_perfil IS NULL
                                        OR destinatario_perfil IN ('admin','gestao','juridico','broker')),
  destinatario_id       uuid                    REFERENCES usuarios(id) ON DELETE SET NULL,
  prazo                 date,
  status                text          NOT NULL DEFAULT 'pendente'
                                      CHECK (status IN ('pendente','em_andamento','concluida','cancelada')),
  concluida_em          timestamptz,
  concluida_por_id      uuid                    REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),

  -- Pelo menos um destinatário (perfil OU pessoa)
  CONSTRAINT tarefas_destinatario CHECK (
    destinatario_perfil IS NOT NULL OR destinatario_id IS NOT NULL
  ),
  -- Concluída exige concluida_em + concluida_por
  CONSTRAINT tarefas_concluida_coerencia CHECK (
    status != 'concluida' OR (concluida_em IS NOT NULL AND concluida_por_id IS NOT NULL)
  )
);

COMMENT ON TABLE tarefas IS
  'Ações estruturadas com prazo dentro de uma operação. Broker↔time interno. Diferente de comentários (conversa livre).';

CREATE INDEX idx_tarefas_operacao_id     ON tarefas(operacao_id);
CREATE INDEX idx_tarefas_destinatario_id ON tarefas(destinatario_id) WHERE destinatario_id IS NOT NULL;
CREATE INDEX idx_tarefas_status_prazo    ON tarefas(status, prazo) WHERE status IN ('pendente','em_andamento');
CREATE INDEX idx_tarefas_criado_por      ON tarefas(criado_por_id) WHERE criado_por_id IS NOT NULL;

CREATE TRIGGER tarefas_set_updated_at
  BEFORE UPDATE ON tarefas
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- RLS
ALTER TABLE tarefas ENABLE ROW LEVEL SECURITY;

-- SELECT: user vê tarefa se vê a operação (herda RLS de operacoes via EXISTS)
CREATE POLICY "tarefas_select" ON tarefas FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM operacoes WHERE operacoes.id = tarefas.operacao_id));

-- INSERT: qualquer perfil que vê a operação pode criar tarefa nela
CREATE POLICY "tarefas_insert" ON tarefas FOR INSERT TO authenticated
  WITH CHECK (
    criado_por_id = auth.uid()
    AND EXISTS (SELECT 1 FROM operacoes WHERE operacoes.id = tarefas.operacao_id)
  );

-- UPDATE: criador, destinatário direto, ou admin/gestao
CREATE POLICY "tarefas_update" ON tarefas FOR UPDATE TO authenticated
  USING (
    criado_por_id = auth.uid()
    OR destinatario_id = auth.uid()
    OR public.get_user_role() IN ('admin', 'gestao')
  )
  WITH CHECK (
    criado_por_id = auth.uid()
    OR destinatario_id = auth.uid()
    OR public.get_user_role() IN ('admin', 'gestao')
  );

-- DELETE: só admin
CREATE POLICY "tarefas_delete_admin" ON tarefas FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');


-- Trigger: notifica destinatário ao criar tarefa
CREATE OR REPLACE FUNCTION public.notif_tarefa_nova() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  criador_nome text;
  op_numero    text;
  destinatarios_ids uuid[];
BEGIN
  SELECT COALESCE(u.nome, u.email) INTO criador_nome
    FROM public.usuarios u WHERE u.id = NEW.criado_por_id;
  SELECT o.numero_processo INTO op_numero
    FROM public.operacoes o WHERE o.id = NEW.operacao_id;

  -- Coleta destinatários: se destinatario_id, é ele; senão todos com o perfil
  IF NEW.destinatario_id IS NOT NULL THEN
    destinatarios_ids := ARRAY[NEW.destinatario_id];
  ELSIF NEW.destinatario_perfil IS NOT NULL THEN
    SELECT array_agg(u.id) INTO destinatarios_ids
    FROM public.usuarios u
    JOIN public.perfis p ON p.id = u.perfil_id
    WHERE p.slug = NEW.destinatario_perfil AND u.ativo = true AND u.id != NEW.criado_por_id;
  END IF;

  IF destinatarios_ids IS NULL THEN RETURN NEW; END IF;

  -- Reutiliza a categoria de notificação de operação; se quiser separar, migration futura amplia enum tipo
  INSERT INTO public.notificacoes (destinatario, tipo, titulo, descricao, link)
  SELECT id, 'comentario_novo',  -- usa tipo existente pra evitar migration só disso
    format('Nova tarefa: %s (%s)', NEW.titulo, COALESCE(op_numero, 'operação')),
    format('Atribuída por %s%s', COALESCE(criador_nome, 'alguém'),
           CASE WHEN NEW.prazo IS NOT NULL THEN ' · prazo ' || NEW.prazo::text ELSE '' END),
    '/operacoes/' || NEW.operacao_id
  FROM unnest(destinatarios_ids) AS id
  WHERE id != NEW.criado_por_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tarefas_notificar_nova
  AFTER INSERT ON tarefas
  FOR EACH ROW EXECUTE PROCEDURE public.notif_tarefa_nova();
