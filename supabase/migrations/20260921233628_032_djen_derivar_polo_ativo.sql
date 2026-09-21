-- Corrige a derivação de credor_nome: pegar o destinatário com polo = 'A'
-- (Ativo = credor), não o primeiro do array. O primeiro pode ser o Estado
-- (polo P = Passivo/devedor), e o dado ficaria invertido — o Estado nunca é
-- credor da RGT.
--
-- Descoberto no primeiro teste ponta a ponta da RGT-82: um precatório do
-- TRT19 ficou com credor_nome='ESTADO DE ALAGOAS' porque a jsonb->0 pegou o
-- devedor. Depois da correção: JOSE WELLIGTON ALVES DA SILVA (credor real).

create or replace function djen_derivar_campos() returns trigger
language plpgsql
as $$
declare
  destinatario_ativo jsonb;
begin
  -- Primeiro destinatário com polo = 'A' (credor). Fallback pro primeiro item
  -- se nenhum tiver polo A (raro).
  select d into destinatario_ativo
  from jsonb_array_elements(new.destinatarios) d
  where d->>'polo' = 'A'
  limit 1;

  new.credor_nome      := coalesce(destinatario_ativo ->> 'nome', new.destinatarios -> 0 ->> 'nome');
  new.credor_mascarado := (coalesce(destinatario_ativo, new.destinatarios -> 0) ->> 'mascarado') = 'true';

  new.advogado_nome    := new.destinatario_advogados -> 0 -> 'advogado' ->> 'nome';
  new.advogado_oab     := new.destinatario_advogados -> 0 -> 'advogado' ->> 'numero_oab';
  return new;
end;
$$;

-- Reprocessa o que já foi ingerido pra corrigir os campos derivados.
update djen_publicacoes set ativo = ativo;
