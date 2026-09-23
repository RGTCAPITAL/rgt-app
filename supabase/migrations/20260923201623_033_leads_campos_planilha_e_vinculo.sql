-- =============================================================================
-- 033_leads_campos_planilha_e_vinculo.sql
--
-- O Renato trabalha a prospecção em planilha própria (nome, número do processo,
-- telefone, email, valor do processo, proposta indicativa) e precisa subir isso
-- no CRM. O import atual descarta tudo que não seja nome/telefone/email/cpf,
-- então processo e valor sumiam em silêncio.
--
-- Guardar valor em `notas` (como a RPC virar_prospeccao_em_lead faz hoje) não
-- resolve: texto livre não filtra, não ordena e não vira KPI. Por isso os
-- campos entram tipados.
--
-- `vinculo` existe por uma razão jurídica, não de produto: comunicação com
-- cliente constituído e abordagem a não-cliente têm regimes diferentes
-- (Provimento CFOAB 205/2021, Anexo Único, verbete "mala direta"). Sem marcar
-- isso na origem do dado, a distinção se perde e não há como auditar depois
-- por que cada pessoa foi contatada.
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Contexto: RGT-OS/knowledge/demandas-renato-contato-massa-2026-09-23.md
-- Depende de: 010 (leads)
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Campos da planilha
-- ────────────────────────────────────────────────────────────────

ALTER TABLE leads
  ADD COLUMN numero_processo            text,
  ADD COLUMN valor_processo             numeric(14,2),
  ADD COLUMN valor_proposta_indicativa  numeric(14,2),
  ADD COLUMN lote                       text,
  ADD COLUMN vinculo                    text,
  ADD COLUMN base_legal                 text,
  ADD COLUMN fonte_referencia           text,
  ADD COLUMN data_captura               timestamptz;

COMMENT ON COLUMN leads.numero_processo IS
  'CNJ do processo, quando o lead já chega com processo identificado. Mesmo padrão de operacoes: guardado como veio, comparado por dígitos.';
COMMENT ON COLUMN leads.valor_processo IS
  'Valor que a planilha de origem informou. NÃO é valor atualizado nem valor de face conferido — é o número que o originador tinha à mão.';
COMMENT ON COLUMN leads.valor_proposta_indicativa IS
  'Proposta que o originador tinha em mente. Indicativa: não é oferta e não vai pro cliente sem due diligence (CDC art. 30 — oferta com preço vincula).';
COMMENT ON COLUMN leads.lote IS
  'Identificador do lote de importação, pra rastrear de qual planilha cada lead veio.';
COMMENT ON COLUMN leads.vinculo IS
  'Relação com a pessoa ANTES do primeiro contato. Decide o que pode ser enviado e por qual canal.';
COMMENT ON COLUMN leads.base_legal IS
  'Base legal LGPD do tratamento (consentimento, legitimo_interesse, execucao_contrato). Exigido pro registro de operações da ANPD.';
COMMENT ON COLUMN leads.fonte_referencia IS
  'De onde o dado saiu: nome da planilha, tribunal, formulário do site. Transparência de origem é requisito do art. 9º da LGPD.';
COMMENT ON COLUMN leads.data_captura IS
  'Quando o dado foi capturado na origem — distinto de created_at, que é quando entrou no sistema.';


-- ────────────────────────────────────────────────────────────────
-- 2. Integridade
-- ────────────────────────────────────────────────────────────────

-- Mesmo padrão da 025 em operacoes: valida por dígitos, não pelo texto com
-- máscara. NULL é permitido — nem todo lead chega com processo.
ALTER TABLE leads
  ADD CONSTRAINT leads_cnj_20_digitos
  CHECK (
    numero_processo IS NULL
    OR length(regexp_replace(numero_processo, '\D', '', 'g')) = 20
  );

COMMENT ON CONSTRAINT leads_cnj_20_digitos ON leads IS
  'CNJ tem 20 dígitos. Compara por dígitos porque a base tem CNJ com e sem máscara.';

-- Vocabulário fechado. Texto livre aqui vira lixo e a distinção jurídica
-- que justifica a coluna se perde.
ALTER TABLE leads
  ADD CONSTRAINT leads_vinculo_valido
  CHECK (
    vinculo IS NULL
    OR vinculo IN ('cliente_mandato_vigente', 'ex_cliente', 'lead_frio', 'opt_in')
  );

COMMENT ON CONSTRAINT leads_vinculo_valido ON leads IS
  'cliente_mandato_vigente: procuração ativa, comunicação sobre o processo dele é dever de informação. ex_cliente: mandato extinto (CED art. 13). lead_frio: nunca teve relação. opt_in: pediu contato.';

ALTER TABLE leads
  ADD CONSTRAINT leads_base_legal_valida
  CHECK (
    base_legal IS NULL
    OR base_legal IN ('consentimento', 'legitimo_interesse', 'execucao_contrato')
  );

-- Valores negativos não existem nesse domínio e denunciam erro de parsing
-- (o clássico: "R$ 187.430,00" virando 187.43 ou número negativo).
ALTER TABLE leads
  ADD CONSTRAINT leads_valores_nao_negativos
  CHECK (
    (valor_processo IS NULL OR valor_processo >= 0)
    AND (valor_proposta_indicativa IS NULL OR valor_proposta_indicativa >= 0)
  );


-- ────────────────────────────────────────────────────────────────
-- 3. Índices
-- ────────────────────────────────────────────────────────────────

-- Dedup na importação cruza por CNJ normalizado. NÃO é UNIQUE de propósito:
-- litisconsórcio trabalhista faz várias pessoas dividirem o mesmo processo,
-- então o mesmo CNJ pode legitimamente ter mais de um lead.
CREATE INDEX idx_leads_cnj_normalizado
  ON leads ((regexp_replace(numero_processo, '\D', '', 'g')))
  WHERE numero_processo IS NOT NULL;

COMMENT ON INDEX idx_leads_cnj_normalizado IS
  'Dedup de importação. Não é UNIQUE: litisconsórcio permite vários credores no mesmo CNJ.';

-- Telefone normalizado é a outra metade do par de dedup (CNJ + telefone).
CREATE INDEX idx_leads_telefone_normalizado
  ON leads ((regexp_replace(telefone, '\D', '', 'g')))
  WHERE telefone IS NOT NULL;

CREATE INDEX idx_leads_lote ON leads (lote) WHERE lote IS NOT NULL;
CREATE INDEX idx_leads_vinculo ON leads (vinculo) WHERE vinculo IS NOT NULL;
