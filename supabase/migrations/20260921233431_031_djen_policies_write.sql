-- Admin/gestão/jurídico podem INSERT/UPDATE em djen_publicacoes pelo server
-- action de enriquecimento (que roda como user, não service_role). Sem isso o
-- upsert falha silenciosamente e o item da fila vira status='error'.
--
-- Descoberto no primeiro teste ponta a ponta da RGT-82.

create policy "djen_publicacoes_admin_gestao_juridico_insert" on djen_publicacoes
  for insert with check (get_user_role() in ('admin', 'gestao', 'juridico'));

create policy "djen_publicacoes_admin_gestao_juridico_update" on djen_publicacoes
  for update using (get_user_role() in ('admin', 'gestao', 'juridico'))
  with check (get_user_role() in ('admin', 'gestao', 'juridico'));

-- Mesma coisa pra runs (o job de ingestão vai gravar). Fundos concorrentes
-- ficam só de service_role por ora (populados por job separado, não pelo action).
create policy "djen_runs_admin_gestao_juridico_insert" on djen_ingestao_runs
  for insert with check (get_user_role() in ('admin', 'gestao', 'juridico'));

create policy "djen_runs_admin_gestao_juridico_update" on djen_ingestao_runs
  for update using (get_user_role() in ('admin', 'gestao', 'juridico'))
  with check (get_user_role() in ('admin', 'gestao', 'juridico'));
