-- ============================================================================
-- 026: ONDA 4 (cont.) — taxonomia de notificação e regime especial
--
-- Parte 3 · notificacoes.tipo não tinha 'tarefa_nova', então a trigger gravava
--   tarefa como 'comentario_novo'. Efeito: o sino diz "3 novos comentários" e
--   2 são tarefas; quem clica espera conversa e acha tarefa. Métrica de
--   engajamento em comentários também fica inflada.
--
-- Parte 4 · check_ente_regime_especial só roda em INSERT/UPDATE de operacoes.
--   Se o ente vira regime especial DEPOIS (situação editada em
--   entes_devedores), nada re-avalia: o time segue tocando operação de ente
--   proibido sem aviso — furando o anti-objetivo do Renato (ver RGT-67).
--
-- Parte 5 · etapas_operacao não garantia "no máximo uma etapa aberta por
--   operação". A invariante dependia só da sequência UPDATE-then-INSERT da
--   trigger; qualquer backfill via service_role podia criar duas.
-- ============================================================================


-- ─── Parte 3: taxonomia de notificação ──────────────────────────────────────

ALTER TABLE notificacoes DROP CONSTRAINT IF EXISTS notificacoes_tipo_check;
ALTER TABLE notificacoes ADD CONSTRAINT notificacoes_tipo_check
  CHECK (tipo IN (
    'comentario_novo',
    'etapa_mudou',
    'aceite_registrado',
    'tarefa_nova',
    'ente_regime_especial'
  ));

-- Backfill: as notificações de tarefa gravadas como comentário são
-- identificáveis pelo título que a própria trigger monta.
UPDATE notificacoes
   SET tipo = 'tarefa_nova'
 WHERE tipo = 'comentario_novo'
   AND titulo LIKE 'Nova tarefa:%';

CREATE OR REPLACE FUNCTION public.notif_tarefa_nova()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  criador_nome text; op_numero text; destinatarios_ids uuid[];
BEGIN
  SELECT COALESCE(u.nome, u.email) INTO criador_nome FROM public.usuarios u WHERE u.id = NEW.criado_por_id;
  SELECT o.numero_processo INTO op_numero FROM public.operacoes o WHERE o.id = NEW.operacao_id;
  IF NEW.destinatario_id IS NOT NULL THEN
    destinatarios_ids := ARRAY[NEW.destinatario_id];
  ELSIF NEW.destinatario_perfil IS NOT NULL THEN
    SELECT array_agg(u.id) INTO destinatarios_ids
    FROM public.usuarios u JOIN public.perfis p ON p.id = u.perfil_id
    WHERE p.slug = NEW.destinatario_perfil AND u.ativo = true AND u.id != NEW.criado_por_id;
  END IF;
  IF destinatarios_ids IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.notificacoes (destinatario, tipo, titulo, descricao, link)
  SELECT id, 'tarefa_nova',   -- era 'comentario_novo' por falta do valor no CHECK
    format('Nova tarefa: %s (%s)', NEW.titulo, COALESCE(op_numero, 'operação')),
    format('Atribuída por %s%s', COALESCE(criador_nome, 'alguém'),
           CASE WHEN NEW.prazo IS NOT NULL THEN ' · prazo ' || NEW.prazo::text ELSE '' END),
    '/operacoes/' || NEW.operacao_id
  FROM unnest(destinatarios_ids) AS id
  WHERE id != NEW.criado_por_id;
  RETURN NEW;
END;
$function$;


-- ─── Parte 4: ente que vira regime especial avisa quem tem operação aberta ──

CREATE OR REPLACE FUNCTION public.notif_ente_virou_regime_especial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  afetadas int;
BEGIN
  -- Só interessa a transição para regime especial
  IF NEW.situacao IS NOT DISTINCT FROM OLD.situacao OR NEW.situacao <> 'regime_especial' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO afetadas
  FROM operacoes o
  WHERE o.ente_devedor_id = NEW.id
    AND o.etapa_atual NOT IN ('finalizada', 'cancelada');

  IF afetadas = 0 THEN RETURN NEW; END IF;

  -- Bloquear não faz sentido: o regime especial é um fato do mundo real, e as
  -- operações já existem. O que faltava era alguém FICAR SABENDO.
  INSERT INTO notificacoes (destinatario, tipo, titulo, descricao, link)
  SELECT u.id,
         'ente_regime_especial',
         format('%s entrou em regime especial', NEW.nome),
         format('%s operação(ões) em andamento com esse ente. Revise antes de avançar etapa.', afetadas),
         '/operacoes'
  FROM usuarios u
  JOIN perfis p ON p.id = u.perfil_id
  WHERE u.ativo AND p.slug IN ('admin', 'gestao');

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS entes_notificar_regime_especial ON entes_devedores;
CREATE TRIGGER entes_notificar_regime_especial
  AFTER UPDATE OF situacao ON entes_devedores
  FOR EACH ROW
  EXECUTE FUNCTION public.notif_ente_virou_regime_especial();

COMMENT ON FUNCTION public.notif_ente_virou_regime_especial() IS
  'Avisa admin/gestão quando um ente vira regime especial e há operações em andamento com ele. Complementa check_ente_regime_especial, que só barra no cadastro.';


-- ─── Parte 5: uma etapa aberta por operação ─────────────────────────────────

CREATE UNIQUE INDEX etapas_operacao_uma_aberta
  ON etapas_operacao (operacao_id) WHERE saiu_em IS NULL;

COMMENT ON INDEX etapas_operacao_uma_aberta IS
  'Garante no máximo uma etapa em aberto por operação. Antes a invariante dependia só da ordem das operações na trigger, e um backfill via service_role podia furar.';
