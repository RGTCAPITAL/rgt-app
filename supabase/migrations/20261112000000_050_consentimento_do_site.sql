-- =============================================================================
-- 050_consentimento_do_site.sql
--
-- O formulário do site (credores.html) exige que a pessoa marque a caixa de
-- autorização, mas o "sim" morria no navegador: o lead chegava ao CRM sem
-- registro nenhum de que ela autorizou o contato. Quando alguém disser "nunca
-- pedi pra me ligarem", a RGT precisa mostrar quando e com que texto a pessoa
-- autorizou (LGPD, art. 8º: o ônus da prova do consentimento é de quem trata).
--
-- O webhook do site grava os dois campos. A hora é a do servidor, não a do
-- celular da pessoa. O texto é o que estava na tela no momento do aceite: se
-- o texto do site mudar, os leads antigos continuam com o que aceitaram.
--
-- Uma vez gravado, não muda: é prova. Lead criado à mão no CRM fica vazio.
-- =============================================================================

ALTER TABLE public.leads
  ADD COLUMN consentimento_em timestamptz,
  ADD COLUMN consentimento_texto text;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_consentimento_completo
    CHECK ((consentimento_em IS NULL) = (consentimento_texto IS NULL));

COMMENT ON COLUMN public.leads.consentimento_em IS
  'Quando a pessoa autorizou o contato no formulário do site (hora do servidor). Não muda depois de gravado.';
COMMENT ON COLUMN public.leads.consentimento_texto IS
  'O texto da autorização que a pessoa marcou, como estava na tela. Não muda depois de gravado.';

-- RLS deixa broker editar o lead dele, coluna por coluna. A prova do aceite
-- não pode entrar nisso: nem trocar, nem apagar, nem preencher depois.
CREATE OR REPLACE FUNCTION public.leads_consentimento_imutavel()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.consentimento_em, NEW.consentimento_texto)
     IS DISTINCT FROM (OLD.consentimento_em, OLD.consentimento_texto) THEN
    RAISE EXCEPTION
      'leads: a autorização de contato é prova e não muda depois de gravada.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_consentimento_imutavel
  BEFORE UPDATE OF consentimento_em, consentimento_texto ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_consentimento_imutavel();
