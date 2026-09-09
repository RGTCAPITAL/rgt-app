-- ============================================================================
-- 028: inventário das garantias de segurança do banco (RGT-76)
--
-- Substitui a 027, que trazia o nome errado do trigger de escalação: ele se
-- chama `usuarios_bloquear_escalacao` (a FUNÇÃO é que é
-- bloquear_escalacao_privilegio). O inventário acusava ausência de uma garantia
-- que existe — e a primeira execução do teste pegou isso.
--
-- Por que esta função existe: nem toda barreira pode ser exercitada num teste
-- automatizado sem risco. Provar `garantir_admin_remanescente` de verdade
-- exigiria desativar admins num banco compartilhado.
--
-- Então testamos a PRESENÇA. O modo de falha real que a auditoria (RGT-75)
-- apontou não é "a trigger tem um bug" — é "alguém dropou a trigger numa
-- migration futura e ninguém percebeu, porque nada quebra o build".
--
-- SECURITY DEFINER porque lê o catálogo do Postgres, fora do alcance do usuário
-- autenticado. Devolve só nomes de objetos de schema — nenhum dado de negócio.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.inventario_garantias()
RETURNS TABLE (categoria text, nome text, existe boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Triggers que sustentam regras de negócio e de segurança
  SELECT 'trigger', t.nome,
         EXISTS (
           SELECT 1 FROM pg_trigger g
           JOIN pg_class c ON c.oid = g.tgrelid
           WHERE g.tgname = t.nome AND NOT g.tgisinternal AND c.relname = t.tabela
         )
  FROM (VALUES
    ('usuarios_bloquear_escalacao',     'usuarios'),
    ('trg_garantir_admin_remanescente', 'usuarios'),
    ('entes_notificar_regime_especial', 'entes_devedores'),
    ('operacoes_check_regime_especial', 'operacoes'),
    ('operacoes_log_etapa',             'operacoes')
  ) AS t(nome, tabela)

  UNION ALL

  -- Policies de RLS cuja ausência abriria acesso
  SELECT 'policy', p.nome,
         EXISTS (SELECT 1 FROM pg_policies pol
                  WHERE pol.policyname = p.nome AND pol.tablename = p.tabela)
  FROM (VALUES
    ('dd_judit_insert',                'dd_judit_consultas'),
    ('dd_judit_select',                'dd_judit_consultas'),
    ('prospeccao_insert_admin_gestao', 'prospeccao_precatorios'),
    ('entes_devedores_update_admin',   'entes_devedores')
  ) AS p(nome, tabela)

  UNION ALL

  -- Índices e constraints de integridade
  SELECT 'indice', i.nome,
         EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = i.nome)
  FROM (VALUES
    ('operacoes_cnj_normalizado_unico'),
    ('etapas_operacao_uma_aberta')
  ) AS i(nome)

  UNION ALL

  SELECT 'constraint', c.nome,
         EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.nome)
  FROM (VALUES
    ('operacoes_cnj_20_digitos'),
    ('notificacoes_tipo_check'),
    ('prospeccao_unique_por_lote')
  ) AS c(nome)

  UNION ALL

  -- RLS ligada é pré-requisito de toda policy acima
  SELECT 'rls_habilitada', t.tabela,
         COALESCE((SELECT c.relrowsecurity FROM pg_class c
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE c.relname = t.tabela AND n.nspname = 'public'), false)
  FROM (VALUES
    ('usuarios'), ('operacoes'), ('leads'), ('dd_judit_consultas'),
    ('prospeccao_precatorios'), ('entes_devedores'), ('documentos'), ('tarefas')
  ) AS t(tabela)

  UNION ALL

  -- totais_pipeline() PRECISA ser SECURITY INVOKER: como DEFINER, ela somaria
  -- o workspace inteiro e vazaria o total pra qualquer broker.
  SELECT 'security_invoker', 'totais_pipeline',
         COALESCE((SELECT NOT p.prosecdef FROM pg_proc p
                   JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE p.proname = 'totais_pipeline' AND n.nspname = 'public'), false);
$$;

COMMENT ON FUNCTION public.inventario_garantias() IS
  'Lista as barreiras de segurança/integridade do banco e se cada uma existe. Consumida pelos testes de RLS (RGT-76) para detectar remoção silenciosa em migrations futuras.';

GRANT EXECUTE ON FUNCTION public.inventario_garantias() TO authenticated;
