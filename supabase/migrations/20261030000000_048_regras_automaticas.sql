-- =============================================================================
-- 048_regras_automaticas.sql   (nome provisório: salvar com o timestamp que o
--                               apply_migration gerar — migrations.integration.test.ts
--                               compara git e banco pela version)
--
-- Três regras fixas que olham o CRM todo dia e CRIAM TAREFA PARA UMA PESSOA.
-- Nenhuma manda mensagem sozinha: na RGT quem fala com o credor é gente, e
-- automação escrevendo pro cliente é o que a Meta pune e a OAB olha.
--
--   follow_up       lead em "Em contato" há N dias, sem resposta no WhatsApp
--                   da RGT e sem tarefa aberta → uma tarefa de follow-up pro
--                   dono. Para depois de M tentativas, e a última diz isso.
--   lead_parado     lead numa etapa ativa há N dias sem mudar e sem tarefa
--                   aberta → tarefa (o aviso no sino vem da trigger). Uma vez
--                   por entrada na etapa.
--   processo_andou  a rotina do DJEN, que já avisa publicação nova, passa a
--                   criar a tarefa pro dono. Lead perdido "sem ofício" cujo
--                   processo mostra ofício expedido ganha tarefa de reavaliar:
--                   ninguém é reaberto sozinho.
--
-- As três nascem DESLIGADAS. Ligar é decisão de quem gere a equipe, em
-- /admin/regras.
--
-- O que muda no banco, e por quê:
--   1. leads.status_desde. Hoje ninguém sabe desde quando o lead está na
--      etapa: updated_at muda a cada nota editada. A trigger mexe na coluna
--      só quando o status muda, então cobre todos os caminhos (kanban,
--      disparo do modelo, virar operação, service role).
--      Leads que já existem começam AGORA. Com updated_at, o lead qualificado
--      parado desde 19/10 e os demais cairiam todos no primeiro dia, e a
--      primeira impressão da regra seria uma rajada de tarefas.
--   2. leads.motivo_perda_codigo. motivo_perda é texto livre, e achar "sem
--      ofício" casando texto erra pros dois lados. O modal de perda ganha uma
--      opção que grava o código; o texto continua livre pro detalhe.
--   3. regras_automaticas: chave liga/desliga e dias, editáveis sem deploy.
--      Três linhas fixas, semeadas aqui.
--   4. regras_disparos: quem cada regra atingiu, quando, por quê e com qual
--      tarefa. É também a trava contra repetição: a Vercel não garante uma
--      execução só por dia, e a chave única (regra, chave_ciclo) impede a
--      mesma tarefa duas vezes.
--   5. criar_tarefa_de_regra(): grava o registro e a tarefa na MESMA
--      transação. Separados, uma falha no meio deixaria tarefa sem registro
--      (a regra repetiria amanhã) ou registro sem tarefa (ninguém faria nada).
--   6. notif_tarefa_nova(): tarefa criada pelo sistema (criado_por_id NULL)
--      não avisava ninguém — `id != NULL` dá NULL e o filtro descartava todo
--      mundo, em silêncio. De quebra volta o tipo 'tarefa_nova', que a 038
--      trocou sem querer por 'comentario_novo'.
--   7. modelos_mensagem.uso. O texto "Retomada de contato" existe desde a
--      039, mas o ícone do WhatsApp no card sempre escolhe um de primeiro
--      contato (o "simples" não exige nada e vem antes). O follow-up manda o
--      broker usar a retomada; sem esta coluna ele não tem como achar o texto.
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Depende de: 010 (leads), 013/038 (tarefas), 039 (modelos_mensagem)
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Desde quando o lead está na etapa (e o código do motivo de perda)
-- ────────────────────────────────────────────────────────────────

-- now() é o mesmo em toda a transação: as linhas existentes ganham a hora
-- da migration, de propósito (ver cabeçalho). Default estável = sem reescrever
-- a tabela.
ALTER TABLE public.leads
  ADD COLUMN status_desde timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.leads.status_desde IS
  'Quando o lead entrou na etapa atual. Mantida pela trigger leads_marcar_status_desde. Para lead anterior à 048 é a data da migration, não a entrada real.';

ALTER TABLE public.leads ADD COLUMN motivo_perda_codigo text;

-- Lista de um item só, por enquanto: é o único motivo que alguma regra lê.
-- Código novo entra trocando este CHECK.
ALTER TABLE public.leads ADD CONSTRAINT leads_motivo_perda_codigo_valido CHECK (
  motivo_perda_codigo IS NULL
  OR (motivo_perda_codigo IN ('sem_oficio') AND status = 'perdido')
);

COMMENT ON COLUMN public.leads.motivo_perda_codigo IS
  'Motivo de perda que o sistema entende. sem_oficio = perdido porque ainda não saiu o ofício requisitório; a regra processo_andou continua olhando o Diário desse processo.';

CREATE OR REPLACE FUNCTION public.leads_ao_mudar_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_desde := now();
    -- O código só vale em Perdido. Limpar aqui, e não em cada tela, cobre
    -- também "virar operação" e qualquer caminho futuro. Sem isto, o CHECK
    -- acima barraria a reabertura de um lead perdido sem ofício.
    IF NEW.status <> 'perdido' THEN
      NEW.motivo_perda_codigo := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_marcar_status_desde
  BEFORE UPDATE OF status ON public.leads
  FOR EACH ROW EXECUTE PROCEDURE public.leads_ao_mudar_status();


-- ────────────────────────────────────────────────────────────────
-- 2. As regras: chave liga/desliga e parâmetros
-- ────────────────────────────────────────────────────────────────

CREATE TABLE public.regras_automaticas (
  chave          text PRIMARY KEY
                 CHECK (chave IN ('follow_up', 'lead_parado', 'processo_andou')),
  nome           text NOT NULL CHECK (char_length(trim(nome)) > 0),
  ativa          boolean NOT NULL DEFAULT false,
  parametros     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,

  -- Parâmetro errado não pode virar "tarefa todo dia pra todo mundo". O CASE
  -- de dentro garante a ordem: só converte pra número depois de o texto
  -- provar que é número (AND não garante ordem no Postgres; CASE garante).
  CONSTRAINT regras_automaticas_parametros_validos CHECK (
    CASE chave
      WHEN 'follow_up' THEN
        CASE WHEN parametros->>'dias' ~ '^[0-9]{1,2}$'
              AND parametros->>'max_tentativas' ~ '^[0-9]$'
          THEN (parametros->>'dias')::int BETWEEN 1 AND 30
           AND (parametros->>'max_tentativas')::int BETWEEN 1 AND 5
          ELSE false
        END
      WHEN 'lead_parado' THEN
        CASE WHEN parametros->>'dias' ~ '^[0-9]{1,2}$'
          THEN (parametros->>'dias')::int BETWEEN 1 AND 90
          ELSE false
        END
      ELSE parametros = '{}'::jsonb
    END
  )
);

COMMENT ON TABLE public.regras_automaticas IS
  'As três regras automáticas do CRM. Cada uma só cria tarefa para uma pessoa; nenhuma manda mensagem. Editadas em /admin/regras.';
COMMENT ON COLUMN public.regras_automaticas.parametros IS
  'follow_up: {dias, max_tentativas}. lead_parado: {dias}. processo_andou: {}.';

CREATE TRIGGER regras_automaticas_set_updated_at
  BEFORE UPDATE ON public.regras_automaticas
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.regras_automaticas ENABLE ROW LEVEL SECURITY;

-- Ler não expõe nada sensível: dizer qual regra está ligada ajuda quem
-- recebe a tarefa a entender de onde ela veio.
CREATE POLICY "regras_select" ON public.regras_automaticas FOR SELECT TO authenticated
  USING (true);

-- Ligar uma regra muda o trabalho da equipe inteira: admin e gestão, como
-- nos modelos de mensagem (039). Sem INSERT nem DELETE: as três linhas são
-- fixas e o código conta com elas.
CREATE POLICY "regras_update_admin_gestao" ON public.regras_automaticas FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'gestao'))
  WITH CHECK (public.get_user_role() IN ('admin', 'gestao'));

INSERT INTO public.regras_automaticas (chave, nome, ativa, parametros) VALUES
  ('follow_up',      'Follow-up de lead sem resposta', false, '{"dias": 2, "max_tentativas": 2}'),
  ('lead_parado',    'Lead parado na etapa',           false, '{"dias": 7}'),
  ('processo_andou', 'Processo andou',                 false, '{}');


-- ────────────────────────────────────────────────────────────────
-- 3. Quem foi atingido (e a trava contra repetição)
-- ────────────────────────────────────────────────────────────────
--
-- PK só em id, de propósito: se lead_id e tarefa_id fizessem parte de uma
-- chave composta, o PostgREST veria esta tabela como junção leads↔tarefas e
-- o embed retornos:tarefas(...) do CRM ficaria ambíguo.

CREATE TABLE public.regras_disparos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regra        text NOT NULL REFERENCES public.regras_automaticas(chave),
  lead_id      uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  operacao_id  uuid REFERENCES public.operacoes(id) ON DELETE CASCADE,
  -- Tarefa apagada não reabre o disparo: a pessoa já foi atingida.
  tarefa_id    uuid REFERENCES public.tarefas(id) ON DELETE SET NULL,
  -- O que não pode acontecer duas vezes, montado pelo código. Ex.:
  -- 'follow_up:<lead>:<status_desde>:2', 'lead_parado:<lead>:<etapa>:<status_desde>'.
  chave_ciclo  text NOT NULL CHECK (char_length(chave_ciclo) BETWEEN 1 AND 300),
  tentativa    smallint NOT NULL DEFAULT 1 CHECK (tentativa BETWEEN 1 AND 5),
  -- Em português, pra tela de admin: "Em contato há 3 dias, sem resposta...".
  motivo       text NOT NULL CHECK (char_length(trim(motivo)) > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT regras_disparos_um_alvo CHECK (
    (lead_id IS NOT NULL AND operacao_id IS NULL)
    OR (lead_id IS NULL AND operacao_id IS NOT NULL)
  ),
  CONSTRAINT regras_disparos_sem_repeticao UNIQUE (regra, chave_ciclo)
);

CREATE INDEX idx_regras_disparos_lead
  ON public.regras_disparos (lead_id, regra, created_at)
  WHERE lead_id IS NOT NULL;

-- A tela de admin lista os últimos atingidos.
CREATE INDEX idx_regras_disparos_recentes ON public.regras_disparos (created_at DESC);

-- /tarefas procura o disparo de cada tarefa (o "Criada pela regra ..."), e
-- apagar tarefa precisa achar o disparo pra pôr NULL sem varrer a tabela.
CREATE INDEX idx_regras_disparos_tarefa
  ON public.regras_disparos (tarefa_id)
  WHERE tarefa_id IS NOT NULL;

COMMENT ON TABLE public.regras_disparos IS
  'Cada vez que uma regra automática atingiu um lead ou operação: por quê, quando e qual tarefa criou. A chave (regra, chave_ciclo) impede repetição.';

ALTER TABLE public.regras_disparos ENABLE ROW LEVEL SECURITY;

-- Herda do pai, como tarefas_select (038): broker vê só o que aconteceu com
-- os leads dele; admin e gestão veem tudo.
CREATE POLICY "regras_disparos_select" ON public.regras_disparos FOR SELECT TO authenticated
  USING (
    (lead_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.leads WHERE leads.id = regras_disparos.lead_id))
    OR
    (operacao_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.operacoes WHERE operacoes.id = regras_disparos.operacao_id))
  );
-- Sem INSERT/UPDATE/DELETE: só a rotina escreve, pela função abaixo.


-- ────────────────────────────────────────────────────────────────
-- 4. Registro + tarefa na mesma transação
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.criar_tarefa_de_regra(
  p_regra               text,
  p_chave_ciclo         text,
  p_tentativa           integer,
  p_motivo              text,
  p_lead_id             uuid,
  p_operacao_id         uuid,
  p_destinatario_id     uuid,
  p_destinatario_perfil text,
  p_titulo              text,
  p_descricao           text,
  p_prazo               date
) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_disparo uuid;
  v_tarefa  uuid;
BEGIN
  -- Alguém desligou a regra no meio da rodada: respeita na hora.
  IF NOT EXISTS (SELECT 1 FROM regras_automaticas WHERE chave = p_regra AND ativa) THEN
    RETURN NULL;
  END IF;

  INSERT INTO regras_disparos (regra, lead_id, operacao_id, chave_ciclo, tentativa, motivo)
  VALUES (p_regra, p_lead_id, p_operacao_id, p_chave_ciclo, p_tentativa, p_motivo)
  ON CONFLICT ON CONSTRAINT regras_disparos_sem_repeticao DO NOTHING
  RETURNING id INTO v_disparo;

  -- Já feito numa rodada anterior (ou numa execução em dobro da Vercel).
  IF v_disparo IS NULL THEN
    RETURN NULL;
  END IF;

  -- criado_por_id NULL = criada pelo sistema. A trigger avisa no sino com
  -- "Criada pela regra automática".
  INSERT INTO tarefas (lead_id, operacao_id, titulo, descricao, criado_por_id,
                       destinatario_id, destinatario_perfil, prazo, status)
  VALUES (p_lead_id, p_operacao_id, p_titulo, p_descricao, NULL,
          p_destinatario_id,
          CASE WHEN p_destinatario_id IS NULL THEN p_destinatario_perfil END,
          p_prazo, 'pendente')
  RETURNING id INTO v_tarefa;

  UPDATE regras_disparos SET tarefa_id = v_tarefa WHERE id = v_disparo;
  RETURN v_tarefa;
END;
$$;

COMMENT ON FUNCTION public.criar_tarefa_de_regra IS
  'Registra o disparo e cria a tarefa na mesma transação. Devolve o id da tarefa, ou NULL se a regra está desligada ou este disparo já aconteceu.';

-- Só a rotina (service role). Exposta a authenticated, um broker criaria
-- tarefa "do sistema" pra qualquer pessoa. Mesmo padrão da 045/047.
REVOKE EXECUTE ON FUNCTION public.criar_tarefa_de_regra(
  text, text, integer, text, uuid, uuid, uuid, text, text, text, date
) FROM PUBLIC, anon, authenticated;


-- ────────────────────────────────────────────────────────────────
-- 5. Aviso de tarefa nova que funciona pra tarefa do sistema
-- ────────────────────────────────────────────────────────────────
--
-- Igual à versão da 038 (conferida em produção em 30/10), com três trocas:
--   - `!=` → IS DISTINCT FROM: com criado_por_id NULL, `id != NULL` dava
--     NULL e nenhum aviso saía;
--   - tipo 'tarefa_nova' (a 038 voltou pra 'comentario_novo' sem querer;
--     o CHECK de notificacoes.tipo aceita 'tarefa_nova' desde a 026);
--   - "Criada pela regra automática" no lugar de "Atribuída por alguém", e
--     prazo em DD/MM/AAAA, que é como o broker lê data.

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
    WHERE p.slug = NEW.destinatario_perfil
      AND u.ativo = true
      AND u.id IS DISTINCT FROM NEW.criado_por_id;
  END IF;

  IF destinatarios_ids IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notificacoes (destinatario, tipo, titulo, descricao, link)
  SELECT id, 'tarefa_nova',
    format('Nova tarefa: %s (%s)', NEW.titulo, COALESCE(contexto, 'sem contexto')),
    CASE WHEN NEW.criado_por_id IS NULL THEN 'Criada pela regra automática'
         ELSE format('Atribuída por %s', COALESCE(criador_nome, 'alguém'))
    END
    || CASE WHEN NEW.prazo IS NOT NULL
            THEN ' · prazo ' || to_char(NEW.prazo, 'DD/MM/YYYY') ELSE '' END,
    destino_link
  FROM unnest(destinatarios_ids) AS id
  WHERE id IS DISTINCT FROM NEW.criado_por_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notif_tarefa_nova IS
  'Notifica o destinatário ao criar tarefa, inclusive tarefa criada pelo sistema (criado_por_id NULL). Título e link conforme a tarefa seja de operação ou de lead.';


-- ────────────────────────────────────────────────────────────────
-- 6. Texto de retomada alcançável pelo card
-- ────────────────────────────────────────────────────────────────

ALTER TABLE public.modelos_mensagem
  ADD COLUMN uso text NOT NULL DEFAULT 'primeiro_contato'
  CONSTRAINT modelos_mensagem_uso_valido CHECK (uso IN ('primeiro_contato', 'retomada'));

COMMENT ON COLUMN public.modelos_mensagem.uso IS
  'primeiro_contato: lead em Novo. retomada: lead que já foi contatado (é o texto que o follow-up manda usar).';

-- Nome da 039, sem edição em produção (conferido em 30/10).
UPDATE public.modelos_mensagem SET uso = 'retomada' WHERE nome = 'Retomada de contato';

-- O texto da 039 pergunta "se você chegou a pensar sobre a proposta", mas o
-- follow-up manda usá-lo com quem ainda NÃO recebeu proposta nenhuma (está em
-- Em contato). Texto neutro, que serve pros dois casos. Só troca se ninguém
-- editou em /admin/mensagens: o WHERE confere o texto exato que estava no banco
-- em 31/10.
UPDATE public.modelos_mensagem
SET texto = E'Olá {nome}, tudo bem? Aqui é da RGT Capital de novo.\n\nTe escrevi sobre o seu crédito judicial e queria saber se ficou alguma dúvida. Posso te explicar como funciona, sem compromisso.\n\nSe preferir que eu não escreva mais, é só avisar.'
WHERE nome = 'Retomada de contato'
  AND texto = E'Olá {nome}, tudo bem? Aqui é da RGT Capital de novo.\n\nPassando pra saber se você chegou a pensar sobre a proposta. Qualquer dúvida estou à disposição.\n\nSe preferir que eu não escreva mais, é só avisar.';
