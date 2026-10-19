-- =============================================================================
-- 038_tarefas_de_lead.sql
--
-- "O CRM não funciona" — e a razão número um é esta linha da migration 013:
--
--   operacao_id uuid NOT NULL REFERENCES operacoes(id)
--
-- Tarefa só existe pendurada numa operação. Lead não é operação. Logo, é
-- literalmente impossível agendar um retorno de lead — nem com gambiarra,
-- porque a FK exige uma operação que ainda não existe.
--
-- É o buraco mais caro do CRM: sem agendar follow-up, o broker trabalha de
-- memória, e lead sem retorno marcado é lead perdido.
--
-- Três coisas mudam juntas, e nenhuma funciona sozinha:
--   1. a coluna aceita NULL e nasce a irmã lead_id
--   2. as policies passam a cobrir os dois casos — hoje elas exigem a
--      operação existir, então tarefa de lead seria negada em SELECT e INSERT
--   3. a trigger de notificação monta link e título por tipo, senão o aviso
--      aponta pra /operacoes/null
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Depende de: 013 (tarefas), 010 (leads)
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. A coluna deixa de ser obrigatória e ganha uma irmã
-- ────────────────────────────────────────────────────────────────

ALTER TABLE tarefas ALTER COLUMN operacao_id DROP NOT NULL;

ALTER TABLE tarefas
  ADD COLUMN lead_id uuid REFERENCES leads(id) ON DELETE CASCADE;

COMMENT ON COLUMN tarefas.lead_id IS
  'Lead a que a tarefa pertence, quando não é tarefa de operação. Exatamente um entre operacao_id e lead_id é preenchido.';

-- Tarefa órfã não tem onde aparecer na interface, e tarefa dos dois lados
-- não tem dono claro. Exatamente um.
ALTER TABLE tarefas
  ADD CONSTRAINT tarefas_dono_unico CHECK (
    (operacao_id IS NOT NULL AND lead_id IS NULL)
    OR (operacao_id IS NULL AND lead_id IS NOT NULL)
  );

CREATE INDEX idx_tarefas_lead_id ON tarefas (lead_id) WHERE lead_id IS NOT NULL;

-- A fila de retorno do broker é "minhas tarefas pendentes por prazo".
CREATE INDEX idx_tarefas_lead_pendentes
  ON tarefas (lead_id, prazo)
  WHERE lead_id IS NOT NULL AND status = 'pendente';


-- ────────────────────────────────────────────────────────────────
-- 2. Policies cobrindo os dois casos
-- ────────────────────────────────────────────────────────────────
--
-- A permissão da tarefa HERDA a permissão do pai: quem enxerga o lead
-- enxerga as tarefas dele. Como a RLS de `leads` já restringe broker aos
-- próprios, o EXISTS abaixo respeita isso sozinho — sem duplicar regra.

DROP POLICY IF EXISTS "tarefas_select" ON tarefas;
CREATE POLICY "tarefas_select" ON tarefas FOR SELECT TO authenticated
  USING (
    (operacao_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM operacoes WHERE operacoes.id = tarefas.operacao_id))
    OR
    (lead_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM leads WHERE leads.id = tarefas.lead_id))
  );

DROP POLICY IF EXISTS "tarefas_insert" ON tarefas;
CREATE POLICY "tarefas_insert" ON tarefas FOR INSERT TO authenticated
  WITH CHECK (
    criado_por_id = auth.uid()
    AND (
      (operacao_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM operacoes WHERE operacoes.id = tarefas.operacao_id))
      OR
      (lead_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM leads WHERE leads.id = tarefas.lead_id))
    )
  );


-- ────────────────────────────────────────────────────────────────
-- 3. Notificação que aponta pro lugar certo
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notif_tarefa_nova() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  criador_nome text;
  contexto     text;
  destino_link text;
  destinatarios_ids uuid[];
BEGIN
  SELECT COALESCE(u.nome, u.email) INTO criador_nome
    FROM public.usuarios u WHERE u.id = NEW.criado_por_id;

  -- O rótulo e o link seguem o dono da tarefa. Antes isto era fixo em
  -- operação, e tarefa de lead geraria link pra /operacoes/null.
  IF NEW.operacao_id IS NOT NULL THEN
    SELECT o.numero_processo INTO contexto
      FROM public.operacoes o WHERE o.id = NEW.operacao_id;
    destino_link := '/operacoes/' || NEW.operacao_id;
  ELSE
    SELECT l.nome INTO contexto
      FROM public.leads l WHERE l.id = NEW.lead_id;
    destino_link := '/crm?lead=' || NEW.lead_id;
  END IF;

  IF NEW.destinatario_id IS NOT NULL THEN
    destinatarios_ids := ARRAY[NEW.destinatario_id];
  ELSIF NEW.destinatario_perfil IS NOT NULL THEN
    SELECT array_agg(u.id) INTO destinatarios_ids
    FROM public.usuarios u
    JOIN public.perfis p ON p.id = u.perfil_id
    WHERE p.slug = NEW.destinatario_perfil AND u.ativo = true AND u.id != NEW.criado_por_id;
  END IF;

  IF destinatarios_ids IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notificacoes (destinatario, tipo, titulo, descricao, link)
  SELECT id, 'comentario_novo',
    format('Nova tarefa: %s (%s)', NEW.titulo, COALESCE(contexto, 'sem contexto')),
    format('Atribuída por %s%s', COALESCE(criador_nome, 'alguém'),
           CASE WHEN NEW.prazo IS NOT NULL THEN ' · prazo ' || NEW.prazo::text ELSE '' END),
    destino_link
  FROM unnest(destinatarios_ids) AS id
  WHERE id != NEW.criado_por_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notif_tarefa_nova IS
  'Notifica o destinatário ao criar tarefa. Monta título e link conforme a tarefa seja de operação ou de lead.';
