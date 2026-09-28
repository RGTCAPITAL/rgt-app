-- =============================================================================
-- 035_marcar_dados_exemplo.sql
--
-- O Renato vai entrar na plataforma pela primeira vez e o banco tem dados de
-- duas naturezas misturadas: 14 operações e 9 leads inventados pra testar o
-- fluxo, e 128 prospecções + 122 publicações do DJEN que são reais (planilha
-- do TRT19 e API do CNJ).
--
-- Sem marcação, não existe como ele distinguir. Pior: os nomes inventados
-- parecem gente de verdade, e ele pode achar que a empresa tem operação
-- rodando onde não tem.
--
-- Flag em vez de prefixo no nome ("[EXEMPLO] João Silva") porque prefixo
-- suja o dado, quebra ordenação alfabética e exige editar texto pra limpar.
-- A flag sai com um UPDATE e a UI decide como sinalizar.
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Depende de: 002 (operacoes), 010 (leads), 013 (tarefas)
-- =============================================================================


-- ────────────────────────────────────────────────────────────────
-- 1. Coluna
-- ────────────────────────────────────────────────────────────────

ALTER TABLE operacoes ADD COLUMN is_exemplo boolean NOT NULL DEFAULT false;
ALTER TABLE leads     ADD COLUMN is_exemplo boolean NOT NULL DEFAULT false;
ALTER TABLE tarefas   ADD COLUMN is_exemplo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN operacoes.is_exemplo IS
  'Registro de demonstração, não é operação real da RGT. A UI mostra selo e o dashboard avisa. Limpar com UPDATE quando a operação real começar.';
COMMENT ON COLUMN leads.is_exemplo IS
  'Lead de demonstração, não é pessoa real em prospecção.';
COMMENT ON COLUMN tarefas.is_exemplo IS
  'Tarefa de demonstração, presa a uma operação de exemplo.';


-- ────────────────────────────────────────────────────────────────
-- 2. Marca o que já existe
-- ────────────────────────────────────────────────────────────────

-- As 14 operações nasceram do seed de 02-03/09, nenhuma é real
UPDATE operacoes SET is_exemplo = true WHERE created_at < '2026-09-04';

-- Leads: o seed de 02/09 e o lote de teste do importador.
-- Fica de fora quem veio da prospecção real do TRT19 — é pessoa de verdade.
UPDATE leads SET is_exemplo = true
WHERE created_at < '2026-09-03'
   OR lote = 'planilha-teste-renato';

-- Tarefas presas a operação de exemplo herdam a marca
UPDATE tarefas SET is_exemplo = true
WHERE operacao_id IN (SELECT id FROM operacoes WHERE is_exemplo);


-- ────────────────────────────────────────────────────────────────
-- 3. Índices parciais
-- ────────────────────────────────────────────────────────────────

-- Filtrar exemplo é consulta de contagem no dashboard, não de listagem.
-- Índice parcial só no lado verdadeiro: o conjunto é pequeno e some quando
-- os dados de demo forem limpos.
CREATE INDEX idx_operacoes_exemplo ON operacoes (is_exemplo) WHERE is_exemplo;
CREATE INDEX idx_leads_exemplo ON leads (is_exemplo) WHERE is_exemplo;
