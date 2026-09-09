-- ============================================================================
-- 024: virarLead como uma transação só
--
-- ONDA 2 da auditoria (RGT-75), item T3.
--
-- Antes eram dois passos na server action: INSERT em leads, depois UPDATE em
-- prospeccao_precatorios. Se o segundo falhasse (race com outro broker que já
-- descartou, RLS regredida, constraint), o lead ficava órfão no CRM e a
-- prospecção seguia no estado antigo — o broker tentava de novo e criava um
-- segundo lead duplicado.
--
-- Uma função PL/pgSQL roda numa transação implícita: ou os dois passos valem,
-- ou nenhum. SECURITY INVOKER (padrão) mantém a RLS de leads e de
-- prospeccao_precatorios valendo pra quem chama.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.virar_prospeccao_em_lead(
  p_prospeccao_id uuid,
  p_nome          text,
  p_telefone      text,
  p_email         text,
  p_notas         text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_prosp   record;
  v_lead_id uuid;
  v_notas   text;
BEGIN
  IF p_nome IS NULL OR char_length(trim(p_nome)) < 2 THEN
    RAISE EXCEPTION 'Nome do credor obrigatório' USING ERRCODE = 'check_violation';
  END IF;

  -- FOR UPDATE trava a linha: dois brokers clicando ao mesmo tempo serializam,
  -- e o segundo enxerga o status já alterado pelo primeiro.
  SELECT id, cedente_cpf_provavel, numero_processo, tribunal, valor_face, status
    INTO v_prosp
  FROM prospeccao_precatorios
  WHERE id = p_prospeccao_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prospecção não encontrada ou sem permissão'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_prosp.status = 'lead_criado' THEN
    RAISE EXCEPTION 'Esta prospecção já virou lead' USING ERRCODE = 'check_violation';
  END IF;

  IF v_prosp.status = 'descartado' THEN
    RAISE EXCEPTION 'Esta prospecção foi descartada' USING ERRCODE = 'check_violation';
  END IF;

  v_notas := concat_ws(
    E'\n',
    NULLIF(trim(COALESCE(p_notas, '')), ''),
    format('Origem: prospecção %s · Proc %s', v_prosp.tribunal, v_prosp.numero_processo),
    CASE WHEN v_prosp.valor_face IS NOT NULL
      THEN format('Valor face: R$ %s', trim(to_char(v_prosp.valor_face, '999G999G999D99')))
    END
  );

  INSERT INTO leads (nome, telefone, email, cpf_cnpj, origem, status, dono_id, notas)
  VALUES (
    trim(p_nome),
    NULLIF(trim(COALESCE(p_telefone, '')), ''),
    NULLIF(trim(COALESCE(p_email, '')), ''),
    v_prosp.cedente_cpf_provavel,
    'outro',
    'em_contato',
    auth.uid(),
    v_notas
  )
  RETURNING id INTO v_lead_id;

  UPDATE prospeccao_precatorios
     SET status = 'lead_criado',
         lead_id = v_lead_id,
         responsavel_id = auth.uid()
   WHERE id = p_prospeccao_id;

  IF NOT FOUND THEN
    -- RLS bloqueou o UPDATE: aborta tudo, incluindo o lead recém-inserido
    RAISE EXCEPTION 'Sem permissão para atualizar a prospecção'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN v_lead_id;
END;
$$;

COMMENT ON FUNCTION public.virar_prospeccao_em_lead IS
  'Cria o lead e marca a prospecção numa transação só. Evita lead órfão quando o segundo passo falha, e serializa cliques concorrentes com FOR UPDATE.';
