-- ============================================================================
-- 025: ONDA 4 da auditoria (RGT-75) — integridade de dados
--
-- Parte 1 · CNJ: nada impedia duas operações no mesmo precatório, e qualquer
--   string entrava no campo. Verificado antes de aplicar: 14 operações, nenhuma
--   duplicada, todas com 20 dígitos — porém TODAS mascaradas.
--   Por isso o UNIQUE vai sobre a expressão normalizada e não sobre o texto:
--   '0001234-56.2020.5.19.0001' e '00012345620205190001' são o MESMO processo,
--   e um UNIQUE no texto cru deixaria os dois entrarem.
--
-- Parte 2 · entes_devedores: a policy admin era FOR ALL, então permitia DELETE,
--   apesar do comentário da tabela dizer "desativa, não deleta pra preservar
--   histórico". Com operacoes.ente_devedor_id ON DELETE SET NULL, um DELETE
--   apagaria em silêncio o vínculo de todas as operações históricas.
-- ============================================================================


-- ─── Parte 1: unicidade e formato do CNJ ────────────────────────────────────

CREATE UNIQUE INDEX operacoes_cnj_normalizado_unico
  ON operacoes ((regexp_replace(numero_processo, '\D', '', 'g')));

COMMENT ON INDEX operacoes_cnj_normalizado_unico IS
  'Impede duas operações no mesmo precatório. Compara só os dígitos, então máscara diferente não engana.';

ALTER TABLE operacoes
  ADD CONSTRAINT operacoes_cnj_20_digitos
  CHECK (length(regexp_replace(numero_processo, '\D', '', 'g')) = 20);

COMMENT ON CONSTRAINT operacoes_cnj_20_digitos ON operacoes IS
  'CNJ tem 20 dígitos. Aceita com ou sem máscara, mas não aceita texto arbitrário.';


-- ─── Parte 2: ente devedor não se apaga, se desativa ────────────────────────

DROP POLICY IF EXISTS "entes_devedores_admin_all" ON entes_devedores;

CREATE POLICY "entes_devedores_insert_admin"
  ON entes_devedores FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "entes_devedores_update_admin"
  ON entes_devedores FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- Sem policy de DELETE: ninguém apaga ente devedor pela aplicação. Para tirar
-- de circulação existe `ativo = false`, que preserva o histórico das operações.

COMMENT ON TABLE entes_devedores IS
  'Entes devedores de precatório. Não há DELETE pela aplicação: desative com ativo=false. Apagar quebraria o vínculo histórico das operações (FK é ON DELETE SET NULL).';
