-- ============================================================================
-- 020: usuário nasce com o perfil que o admin escolheu no convite
--
-- Contexto: o cadastro público (/cadastro) foi removido. Todo usuário agora
-- entra por convite de um admin, que já escolhe o perfil na hora. O trigger
-- passa a ler esse perfil dos metadados do convite.
--
-- Substitui o comportamento da migration 006 (todo mundo virava 'broker'),
-- que combinado ao cadastro aberto deixava qualquer pessoa da internet virar
-- broker e enxergar a fila de prospecção inteira.
--
-- Fallback: sem perfil nos metadados, cai em 'broker' (menor privilégio entre
-- os existentes) — não deve acontecer via convite, mas evita perfil_id NULL,
-- que faz get_user_role() retornar NULL e travar o usuário em tudo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  perfil_convite text;
  perfil_escolhido uuid;
BEGIN
  perfil_convite := NEW.raw_user_meta_data->>'perfil';

  -- Só aceita slug que exista de fato — metadado é dado de entrada
  IF perfil_convite IS NOT NULL THEN
    SELECT id INTO perfil_escolhido
    FROM public.perfis
    WHERE slug = perfil_convite;
  END IF;

  IF perfil_escolhido IS NULL THEN
    SELECT id INTO perfil_escolhido FROM public.perfis WHERE slug = 'broker';
  END IF;

  INSERT INTO public.usuarios (id, email, nome, perfil_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    perfil_escolhido
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Cria usuario em public.usuarios ao inserir em auth.users. Usa o perfil escolhido pelo admin no convite (raw_user_meta_data->>perfil); cai em broker se ausente ou inválido.';
