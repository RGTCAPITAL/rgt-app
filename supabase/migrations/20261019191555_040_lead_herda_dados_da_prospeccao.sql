-- =============================================================================
-- 040_lead_herda_dados_da_prospeccao.sql
--
-- Quando uma prospecção vira lead, ela perde os dados que mais importam.
--
-- A RPC `virar_prospeccao_em_lead` lê tribunal, processo e valor de face da
-- prospecção e joga tudo em `notas`, como texto concatenado:
--
--   "Origem: prospecção TJAL · Proc 0001107-33... / Valor face: R$ 187.430,00"
--
-- Texto livre não filtra, não ordena, não soma e não vira KPI. O kanban não
-- consegue mostrar o valor do lead, a mensagem de WhatsApp não consegue citar
-- quem é o devedor, e ninguém consegue perguntar "quanto tenho em pipeline do
-- Estado de Alagoas".
--
-- Os campos tipados já existem desde a migration 033 — a RPC é que nunca foi
-- atualizada pra usá-los. Falta só `ente_devedor`, que nasce aqui.
--
-- Guardado como texto, igual à prospecção, e não como FK para
-- `entes_devedores`: a prospecção vem de planilha de tribunal, onde o nome do
-- ente chega escrito de formas diferentes. Normalizar isso é outro problema,
-- e travar a conversão numa FK faria o broker perder o lead por causa de uma
-- divergência de grafia.
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Depende de: 024 (a RPC), 033 (campos tipados em leads)
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. O campo que faltava
-- ────────────────────────────────────────────────────────────────

ALTER TABLE leads ADD COLUMN ente_devedor text;

COMMENT ON COLUMN leads.ente_devedor IS
  'Quem deve o crédito (Estado de Alagoas, INSS, Município…). Texto, como vem da prospecção — o nome chega com grafias diferentes nas planilhas de tribunal.';

CREATE INDEX idx_leads_ente_devedor
  ON leads (ente_devedor)
  WHERE ente_devedor IS NOT NULL;


-- ────────────────────────────────────────────────────────────────
-- 2. A conversão passa a preencher campo, não texto
-- ────────────────────────────────────────────────────────────────

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
BEGIN
  IF p_nome IS NULL OR char_length(trim(p_nome)) < 2 THEN
    RAISE EXCEPTION 'Nome do credor obrigatório' USING ERRCODE = 'check_violation';
  END IF;

  -- FOR UPDATE trava a linha: dois brokers clicando ao mesmo tempo serializam,
  -- e o segundo enxerga o status já alterado pelo primeiro.
  SELECT id, cedente_cpf_provavel, numero_processo, tribunal, valor_face,
         ente_devedor_nome, status
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

  -- Processo, valor e devedor agora vão para colunas próprias. `notas` volta
  -- a ser o que o usuário escreveu, sem metadado concatenado.
  INSERT INTO leads (
    nome, telefone, email, cpf_cnpj, origem, status, dono_id, notas,
    numero_processo, valor_processo, ente_devedor, fonte_referencia, data_captura
  )
  VALUES (
    trim(p_nome),
    NULLIF(trim(COALESCE(p_telefone, '')), ''),
    NULLIF(trim(COALESCE(p_email, '')), ''),
    v_prosp.cedente_cpf_provavel,
    'lista_processual',
    'em_contato',
    auth.uid(),
    NULLIF(trim(COALESCE(p_notas, '')), ''),
    v_prosp.numero_processo,
    v_prosp.valor_face,
    v_prosp.ente_devedor_nome,
    format('Prospecção %s', v_prosp.tribunal),
    now()
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
  'Cria o lead e marca a prospecção numa transação só. Processo, valor e ente devedor vão para colunas tipadas — antes eram concatenados em notas, onde não filtravam nem somavam.';


-- ────────────────────────────────────────────────────────────────
-- 3. Backfill dos leads já convertidos
-- ────────────────────────────────────────────────────────────────
--
-- A prospecção guarda `lead_id`, então dá pra recuperar o que se perdeu.
-- Só preenche o que está vazio: lead editado à mão tem precedência sobre
-- o dado de origem.

UPDATE leads l
SET ente_devedor   = COALESCE(l.ente_devedor, p.ente_devedor_nome),
    numero_processo = COALESCE(l.numero_processo, p.numero_processo),
    valor_processo  = COALESCE(l.valor_processo, p.valor_face)
FROM prospeccao_precatorios p
WHERE p.lead_id = l.id
  AND (l.ente_devedor IS NULL OR l.numero_processo IS NULL OR l.valor_processo IS NULL);
