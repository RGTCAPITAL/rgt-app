-- =============================================================================
-- 041_fatores_loa.sql
--
-- O percentual de aquisição por ano de LOA, definido pelo Renato.
--
-- POR QUE ESTA TABELA EXISTE, nas palavras dele (áudio de 2026-10-20):
--
--   "Você não precisa se preocupar com a conta, você tem que deixar programado
--    pra que eu possa fazer alterações. (...) Precatório LOA 26, esse mês vou
--    pagar 55%, próximo mês eu posso pagar 65%. Então quem vai dizer sou eu,
--    no meu dia a dia, porque eu tenho que fazer essas análises."
--
-- Ou seja: o deságio NÃO é calculado pelo sistema. É um parâmetro que ele
-- mantém, e a plataforma aplica. A razão de mudar todo mês também é dele:
-- "cada vez mais que se aproxima do pagamento do governo, maior será a minha
-- proposta" — quanto menos tempo falta, menos desconto.
--
-- POR QUE É TEMPORAL E NÃO UMA LINHA POR LOA:
--
-- "Esse mês 55%, próximo mês 65%" significa que o valor muda. E a migration
-- 021 já estabeleceu a regra da casa: "o valor usado num cálculo não pode
-- mudar depois". Uma proposta feita em outubro a 55% tem que continuar
-- explicável em dezembro, quando o parâmetro for 65% — senão a memória de
-- cálculo mente sobre o que foi proposto.
--
-- Daí append-only com `vigente_desde`: o percentual aplicável numa data é o da
-- linha mais recente cuja vigência já começou. O histórico sai de graça.
--
-- O QUE AINDA NÃO ESTÁ DECIDIDO: se o percentual incide sobre o valor de face
-- ou sobre o líquido cedível. A diferença num precatório de R$ 1 milhão com
-- R$ 400 mil de deduções é de R$ 220 mil. Por isso `base` é NOT NULL e sem
-- default: quem cadastra escolhe, e a tela pergunta com essas palavras. Não
-- existe valor "padrão" aqui — chutar produziria preço errado em operação real.
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Depende de: 002 (operacoes.loa), 001 (usuarios, get_user_role)
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Sobre o que o percentual incide
-- ────────────────────────────────────────────────────────────────

CREATE TYPE base_desagio AS ENUM ('face', 'liquido');

COMMENT ON TYPE base_desagio IS
  'face = percentual sobre o valor de face do precatório. liquido = sobre o líquido cedível, depois de PSS, IR e honorários (Res. CJF 983/2026 art. 22).';


-- ────────────────────────────────────────────────────────────────
-- 2. A tabela
-- ────────────────────────────────────────────────────────────────

CREATE TABLE fatores_loa (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ano da Lei Orçamentária Anual em que o precatório entra pra pagamento.
  -- Casa com operacoes.loa, que é int e já existe desde a migration 002.
  loa_ano        int           NOT NULL,

  -- 55.000 = 55%. Três casas porque meio ponto percentual em precatório de
  -- sete dígitos é dinheiro: 0,5% de R$ 3 milhões são R$ 15 mil.
  percentual     numeric(6,3)  NOT NULL,

  base           base_desagio  NOT NULL,

  -- A partir de quando vale. O percentual de uma data é o da linha mais
  -- recente cuja vigência já começou naquela data.
  vigente_desde  date          NOT NULL,

  -- Por que ele mudou. Texto livre, pra ele registrar o raciocínio
  -- ("liberaram o orçamento", "ente entrou em regime especial").
  observacao     text,

  criado_por     uuid          REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),

  -- Um percentual de 0 significaria pagar nada; acima de 100 seria pagar mais
  -- que o crédito vale. Os dois são erro de digitação, não decisão.
  CONSTRAINT fatores_loa_percentual_valido
    CHECK (percentual > 0 AND percentual <= 100),

  -- Precatório não tem LOA de 1998 nem de 2200. A faixa pega dedo errado.
  CONSTRAINT fatores_loa_ano_valido
    CHECK (loa_ano BETWEEN 2020 AND 2100),

  -- Uma vigência por LOA por data. Corrigir o valor do mesmo dia é UPDATE,
  -- não uma segunda linha competindo pela mesma data.
  CONSTRAINT fatores_loa_unico_por_vigencia
    UNIQUE (loa_ano, vigente_desde)
);

COMMENT ON TABLE fatores_loa IS
  'Percentual de aquisição por ano de LOA, mantido pelo Renato. Append-only e temporal: uma proposta feita no passado continua explicável depois que o parâmetro muda.';
COMMENT ON COLUMN fatores_loa.vigente_desde IS
  'Início da vigência. O percentual de uma data é o da linha mais recente cuja vigência já começou.';
COMMENT ON COLUMN fatores_loa.base IS
  'Sem default de propósito: face e líquido dão preços muito diferentes, e chutar produziria proposta errada em operação real.';

CREATE INDEX idx_fatores_loa_busca
  ON fatores_loa (loa_ano, vigente_desde DESC);


-- ────────────────────────────────────────────────────────────────
-- 3. O passado não se reescreve
-- ────────────────────────────────────────────────────────────────
--
-- Sem isto, a tabela temporal não garante nada: bastaria inserir uma linha com
-- `vigente_desde` antigo pra mudar retroativamente qual percentual uma
-- proposta de outubro "usou".
--
-- Corrigir o valor da vigência mais recente continua permitido — é typo do
-- mesmo dia, e tem que dar pra consertar. O que não dá é inventar vigência
-- anterior a uma que já existe.

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

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fatores_loa_nao_reescreve_passado
  BEFORE INSERT OR UPDATE ON fatores_loa
  FOR EACH ROW EXECUTE FUNCTION public.fatores_loa_nao_reescreve_passado();


-- ────────────────────────────────────────────────────────────────
-- 4. Qual fator a operação usou
-- ────────────────────────────────────────────────────────────────
--
-- Deriva-se da tabela temporal na maioria dos casos, mas não em todos: a
-- correção de typo do mesmo dia (permitida acima) mudaria a resposta. Gravar o
-- id no momento em que o preço é salvo prega a resposta para sempre.
--
-- Fica nullable porque as 7 operações que já têm preço foram precificadas à
-- mão, antes de existir fator — e inventar um vínculo retroativo seria
-- exatamente a mentira que esta migration tenta evitar.

ALTER TABLE operacoes
  ADD COLUMN fator_loa_id uuid REFERENCES fatores_loa(id) ON DELETE RESTRICT;

COMMENT ON COLUMN operacoes.fator_loa_id IS
  'O fator exato usado pra calcular preco_proposto. Null em operação precificada à mão ou antes da tabela existir.';


-- ────────────────────────────────────────────────────────────────
-- 5. RLS
-- ────────────────────────────────────────────────────────────────
--
-- Leitura pra todo autenticado: a tela de precificação precisa, e broker
-- também vê o preço das operações dele.
-- Escrita só admin e gestão — é o parâmetro que define quanto a empresa paga.
-- DELETE não tem policy nenhuma: ninguém apaga histórico de preço.

ALTER TABLE fatores_loa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fatores_loa_select_autenticados"
  ON fatores_loa FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "fatores_loa_insert_gestao"
  ON fatores_loa FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'gestao'));

CREATE POLICY "fatores_loa_update_gestao"
  ON fatores_loa FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'gestao'))
  WITH CHECK (public.get_user_role() IN ('admin', 'gestao'));


-- ────────────────────────────────────────────────────────────────
-- 6. Sem seed, de propósito
-- ────────────────────────────────────────────────────────────────
--
-- A tentação é semear 2027=0,75 e 2028=0,65, que foi o que o Renato citou em
-- setembro. Não vai: aqueles números vieram de conversa, sem base definida, e
-- apareceriam na tela com a mesma aparência de um valor que ele conferiu.
--
-- A tela mostra "percentual não cadastrado" até ele preencher. É a regra do
-- módulo de precificação: falta é um estado nomeado, não um número plausível.
