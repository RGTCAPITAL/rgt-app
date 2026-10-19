-- =============================================================================
-- 039_modelos_mensagem.sql
--
-- Textos de primeiro contato, editáveis sem passar pelo dev.
--
-- O botão de WhatsApp no card abre a conversa com a mensagem já escrita, com
-- nome e valor daquela pessoa. Quem envia continua sendo o broker, do próprio
-- aparelho — o que mantém zero risco de bloqueio e dispensa a verificação da
-- Meta. O ganho é de tempo: de ~2 minutos por contato para ~20 segundos.
--
-- O texto mora no banco e não no código porque vai mudar toda semana nas
-- primeiras semanas: o Renato vai testar o que converte. Pedir deploy pra
-- trocar uma vírgula é o caminho mais curto pra ele parar de usar.
--
-- `requer_valor` e `requer_ente` existem pra mensagem nunca sair com buraco:
-- o sistema escolhe o modelo mais completo que os dados do lead sustentam, e
-- desce pro mais simples quando falta informação. Melhor frase curta e certa
-- do que "seu precatório de R$ " sem número.
--
-- NOTA: `leads` ainda não guarda ente devedor, então o modelo de ordem 10
-- nunca é escolhido hoje — a prospecção tem esse dado e o perde ao virar
-- lead. O modelo fica porque o seletor já o aproveita no dia em que a coluna
-- existir, e porque descer de modelo é comportamento testado.
--
-- Aplicar via: Supabase MCP (apply_migration)
-- Depende de: 001 (usuarios)
-- =============================================================================

CREATE TABLE modelos_mensagem (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text        NOT NULL CHECK (char_length(trim(nome)) > 0),
  texto         text        NOT NULL CHECK (char_length(trim(texto)) > 0),

  -- Requisitos de dado. O seletor usa isto pra não montar frase quebrada.
  requer_valor  boolean     NOT NULL DEFAULT false,
  requer_ente   boolean     NOT NULL DEFAULT false,

  -- Menor primeiro. Modelos mais específicos ficam na frente.
  ordem         integer     NOT NULL DEFAULT 100,
  ativo         boolean     NOT NULL DEFAULT true,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid       REFERENCES usuarios(id) ON DELETE SET NULL
);

COMMENT ON TABLE modelos_mensagem IS
  'Textos de primeiro contato usados no botão de WhatsApp do CRM. Variáveis: {nome}, {nome_completo}, {valor}, {ente}, {processo}.';
COMMENT ON COLUMN modelos_mensagem.requer_valor IS
  'Modelo que cita valor só é oferecido a lead que tem valor. Evita "precatório de R$ " vazio.';
COMMENT ON COLUMN modelos_mensagem.ordem IS
  'Menor primeiro. O sistema usa o primeiro modelo ativo cujos requisitos o lead atende.';

CREATE INDEX idx_modelos_mensagem_ativos
  ON modelos_mensagem (ordem)
  WHERE ativo;

CREATE TRIGGER modelos_mensagem_set_updated_at
  BEFORE UPDATE ON modelos_mensagem
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


-- ────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────

ALTER TABLE modelos_mensagem ENABLE ROW LEVEL SECURITY;

-- Todo mundo que usa o CRM precisa ler, pra montar a mensagem no card.
CREATE POLICY "modelos_select" ON modelos_mensagem FOR SELECT TO authenticated
  USING (true);

-- Escrever é de admin e gestão: o texto é a voz da empresa falando com o
-- credor, e mudança errada aqui sai para todo mundo de uma vez.
CREATE POLICY "modelos_insert" ON modelos_mensagem FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'gestao'));

CREATE POLICY "modelos_update" ON modelos_mensagem FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'gestao'))
  WITH CHECK (public.get_user_role() IN ('admin', 'gestao'));

CREATE POLICY "modelos_delete" ON modelos_mensagem FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');


-- ────────────────────────────────────────────────────────────────
-- Modelos iniciais
-- ────────────────────────────────────────────────────────────────
--
-- Três cuidados que vieram da pesquisa sobre golpe de precatório
-- (knowledge/bot-whatsapp-pesquisa-2026-09-23.md): o texto diz quem é a
-- empresa logo na primeira linha, avisa que nunca cobra nada, e oferece
-- saída. Credor de precatório foi orientado pelos próprios tribunais a
-- desconfiar de mensagem assim — soar como golpista derruba a conversa
-- antes dela começar.

INSERT INTO modelos_mensagem (nome, texto, requer_valor, requer_ente, ordem) VALUES
(
  'Primeiro contato — com valor e devedor',
  E'Olá {nome}, bom dia. Aqui é da RGT Capital, empresa de Maceió que trabalha com precatórios.\n\nO senhor tem um crédito a receber de {ente}, no valor de {valor}. A gente compra esse tipo de crédito e paga à vista, em vez de o senhor esperar o pagamento do governo.\n\nPosso te explicar como funciona? Se não tiver interesse, é só avisar que não escrevo mais.\n\nUma coisa importante: a RGT nunca pede depósito, taxa ou PIX. Se alguém pedir dinheiro em nosso nome, é golpe.',
  true, true, 10
),
(
  'Primeiro contato — com valor',
  E'Olá {nome}, bom dia. Aqui é da RGT Capital, empresa de Maceió que trabalha com precatórios.\n\nO senhor tem um crédito judicial a receber no valor de {valor}. A gente compra esse tipo de crédito e paga à vista, em vez de o senhor esperar o pagamento do governo.\n\nPosso te explicar como funciona? Se não tiver interesse, é só avisar que não escrevo mais.\n\nUma coisa importante: a RGT nunca pede depósito, taxa ou PIX. Se alguém pedir dinheiro em nosso nome, é golpe.',
  true, false, 20
),
(
  'Primeiro contato — simples',
  E'Olá {nome}, bom dia. Aqui é da RGT Capital, empresa de Maceió que trabalha com precatórios.\n\nA gente compra crédito judicial e paga à vista, em vez de a pessoa esperar anos pelo pagamento do governo.\n\nPosso te explicar como funciona? Se não tiver interesse, é só avisar que não escrevo mais.\n\nUma coisa importante: a RGT nunca pede depósito, taxa ou PIX. Se alguém pedir dinheiro em nosso nome, é golpe.',
  false, false, 30
),
(
  'Retomada de contato',
  E'Olá {nome}, tudo bem? Aqui é da RGT Capital de novo.\n\nPassando pra saber se o senhor chegou a pensar sobre a proposta. Qualquer dúvida estou à disposição.\n\nSe preferir que eu não escreva mais, é só avisar.',
  false, false, 40
);
