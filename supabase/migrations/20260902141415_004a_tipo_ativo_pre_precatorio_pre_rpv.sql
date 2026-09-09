-- ============================================================================
-- 004a: amplia o enum tipo_ativo com Pré-Precatório e Pré-RPV
--
-- Separado da 004b de propósito: `ALTER TYPE ... ADD VALUE` precisa commitar
-- antes que o novo valor possa ser USADO. Num arquivo só, um banco recriado do
-- zero falha com "unsafe use of new value of enum type".
--
-- Issue: RGT-46
-- ============================================================================

ALTER TYPE tipo_ativo ADD VALUE IF NOT EXISTS 'pre_precatorio';
ALTER TYPE tipo_ativo ADD VALUE IF NOT EXISTS 'pre_rpv';
