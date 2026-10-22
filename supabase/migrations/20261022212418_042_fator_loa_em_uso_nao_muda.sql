-- =============================================================================
-- 042_fator_loa_em_uso_nao_muda.sql
--
-- Fecha o buraco que a 041 deixou aberto (achado 1 da revisão da RGT-96).
--
-- A 041 proibiu criar vigência ANTERIOR a uma existente, mas deixou corrigir a
-- vigência mais recente a qualquer momento — pensando em typo do mesmo dia. Só
-- que "a qualquer momento" inclui semanas depois, quando propostas já apontam
-- pra ela via operacoes.fator_loa_id. Corrigir 55% pra 60% ali faria uma
-- proposta feita a 55% passar a "ter usado" 60%. É exatamente a mentira que a
-- 041 diz evitar.
--
-- A regra agora: enquanto nenhuma operação usou o fator, ele pode ser corrigido
-- (o typo do mesmo dia continua consertável). Depois que alguma usou, percentual,
-- base, ano e vigência ficam congelados — mudar o preço é cadastrar vigência
-- nova, que é o que o Renato faz no mês seguinte de qualquer jeito. A
-- observação continua editável: é texto explicativo, não muda conta.
--
-- E a correção deixa rastro. O upsert do painel sobrescrevia criado_por com
-- quem corrigiu, apagando quem cadastrou. Agora criado_por é preservado e quem
-- corrigiu vai pra atualizado_por/atualizado_em.
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Depende de: 041
-- =============================================================================

ALTER TABLE fatores_loa
  ADD COLUMN atualizado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN atualizado_em  timestamptz;

COMMENT ON COLUMN fatores_loa.atualizado_por IS
  'Quem corrigiu o fator por último. Null se nunca foi corrigido.';


CREATE OR REPLACE FUNCTION public.fatores_loa_nao_reescreve_passado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ultima date;
BEGIN
  SELECT max(vigente_desde) INTO v_ultima
  FROM fatores_loa
  WHERE loa_ano = NEW.loa_ano
    AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF v_ultima IS NOT NULL AND NEW.vigente_desde < v_ultima THEN
    RAISE EXCEPTION
      'Não dá pra criar vigência em % para a LOA %: já existe uma a partir de %. O percentual do passado não muda, senão uma proposta já feita passaria a ser explicada por um número que não foi o usado.',
      NEW.vigente_desde, NEW.loa_ano, v_ultima
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (NEW.percentual, NEW.base, NEW.loa_ano, NEW.vigente_desde)
         IS DISTINCT FROM (OLD.percentual, OLD.base, OLD.loa_ano, OLD.vigente_desde)
       AND EXISTS (SELECT 1 FROM operacoes WHERE fator_loa_id = OLD.id)
    THEN
      RAISE EXCEPTION
        'O percentual da LOA % a partir de % já foi usado em proposta e não pode mais ser alterado. Para mudar o preço, cadastre uma nova vigência.',
        OLD.loa_ano, OLD.vigente_desde
        USING ERRCODE = 'check_violation';
    END IF;

    NEW.criado_por := OLD.criado_por;
    NEW.created_at := OLD.created_at;
    NEW.atualizado_por := auth.uid();
    NEW.atualizado_em := now();
  END IF;

  RETURN NEW;
END;
$$;
