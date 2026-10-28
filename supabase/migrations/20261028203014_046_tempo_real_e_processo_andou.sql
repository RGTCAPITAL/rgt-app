-- =============================================================================
-- 046_tempo_real_e_processo_andou.sql
--
-- 1. Tempo real. O sino só atualizava quando a pessoa trocava de página: um
--    cliente podia esperar o broker por horas com o aviso parado na tela. As
--    três tabelas entram na publicação do Realtime do Supabase, que respeita a
--    RLS de cada assinante — broker só recebe evento do que já podia ler.
--
-- 2. "Processo andou". Rotina diária consulta o DJEN dos processos em
--    negociação (leads) e em andamento (operações) e avisa o dono quando sai
--    publicação nova. O DJEN limita a 20 consultas por minuto e a função tem
--    5 minutos, então cabem ~75 processos por dia. `djen_acompanhamento`
--    guarda quando cada um foi visto pela última vez: a rotina começa pelos
--    mais antigos, e o rodízio cobre todos quando passar de 75.
-- =============================================================================

ALTER PUBLICATION supabase_realtime
  ADD TABLE public.notificacoes, public.whatsapp_conversas, public.whatsapp_mensagens;

ALTER TABLE public.notificacoes DROP CONSTRAINT notificacoes_tipo_check;
ALTER TABLE public.notificacoes ADD CONSTRAINT notificacoes_tipo_check
  CHECK (tipo = ANY (ARRAY['comentario_novo', 'etapa_mudou', 'aceite_registrado',
                           'tarefa_nova', 'ente_regime_especial', 'whatsapp',
                           'processo_andou']));

CREATE TABLE public.djen_acompanhamento (
  numero_processo  text PRIMARY KEY,
  verificado_em    timestamptz NOT NULL,
  -- Data da publicação mais recente já vista. Só informativo.
  ultima_publicacao date,
  CONSTRAINT djen_acompanhamento_cnj CHECK (numero_processo ~ '^[0-9]{20}$')
);

-- Só a rotina (service role) lê e escreve. Sem policy = ninguém mais.
ALTER TABLE public.djen_acompanhamento ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.djen_acompanhamento IS
  'Quando a rotina diária olhou o DJEN de cada processo acompanhado. Ordena o rodízio.';
