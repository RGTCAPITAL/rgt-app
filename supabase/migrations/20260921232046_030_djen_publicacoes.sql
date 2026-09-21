-- Publicações do DJEN (Diário de Justiça Eletrônico Nacional) — API pública do CNJ.
-- Fonte de dado processual da RGT, substituindo Judit no caso de uso principal
-- (nome de credor + advogado a partir do CNJ). Res. CNJ 455/2022 art. 12 §1º
-- torna esses campos publicidade legal obrigatória — sem termo de uso restritivo.
--
-- Especificação técnica completa em knowledge/tecnico-djen-contrato-2026-09-21.md
-- Emitida na RGT-82.

create extension if not exists pg_trgm;

create table djen_publicacoes (
  -- Chaves da API. id é integer sequencial (compacto); hash é fallback de dedup
  -- e detecta reedição de conteúdo (mesmo id, texto diferente = reedição).
  id                       bigint       primary key,
  hash                     text         not null,

  -- Temporais
  data_disponibilizacao    date         not null,
  data_ingestao            timestamptz  not null default now(),
  data_cancelamento        date,
  motivo_cancelamento      text,

  -- Classificação
  sigla_tribunal           text         not null,
  id_orgao                 integer,
  nome_orgao               text,
  codigo_classe            text,                            -- é STRING na API, não number
  nome_classe              text,
  tipo_comunicacao         text,
  tipo_documento           text,
  meio                     char(1)      not null,           -- 'D' Diário / 'E' Editais
  ativo                    boolean      not null default true,
  status                   text,

  -- Processo
  numero_processo          char(20)     not null,           -- CNJ sem máscara
  numero_processo_mascara  text,                            -- ex "0001350-96.2025.5.19.0000"
  link                     text,

  -- Payloads brutos
  texto                    text         not null,           -- íntegra do despacho
  destinatarios            jsonb        not null default '[]'::jsonb,
  destinatario_advogados   jsonb        not null default '[]'::jsonb,

  -- Extrações populadas no ingest (via lib/djen/red-flags.ts)
  red_flags                jsonb        not null default '[]'::jsonb,  -- [{codigo, categoria, trecho}]
  cessionario_conhecido    text,                            -- fundo/securitizadora citada
  credor_cedente           text,                            -- credor original citado
  ano_orcamentario         integer,                         -- LOA quando aparece

  -- Campos derivados (populados por trigger). Servem pra queries rápidas sem
  -- ter que jsonb->> em toda listagem.
  credor_nome              text,
  credor_mascarado         boolean,
  advogado_nome            text,
  advogado_oab             text,

  -- Snapshot cru pra reprocessamento futuro (novos red flags, novos extratores)
  raw                      jsonb        not null,

  constraint uq_djen_hash unique (hash)
);

comment on table djen_publicacoes is
  'Publicações do DJEN (API pública do CNJ). Fonte primária de credor + advogado a partir do CNJ. Ingestão diária por tribunal.';

-- Índices essenciais pro uso operacional
create index idx_djen_processo         on djen_publicacoes (numero_processo);
create index idx_djen_data_tribunal    on djen_publicacoes (data_disponibilizacao desc, sigla_tribunal);
create index idx_djen_classe           on djen_publicacoes (codigo_classe) where codigo_classe is not null;
create index idx_djen_oab              on djen_publicacoes (advogado_oab) where advogado_oab is not null;
create index idx_djen_tribunal_data    on djen_publicacoes (sigla_tribunal, data_disponibilizacao desc);
create index idx_djen_cessionario      on djen_publicacoes (cessionario_conhecido) where cessionario_conhecido is not null;
create index idx_djen_texto_trgm       on djen_publicacoes using gin (texto gin_trgm_ops);
create index idx_djen_redflags         on djen_publicacoes using gin (red_flags jsonb_path_ops);


-- Deriva campos "flat" a partir dos jsonb. Evita jsonb->> em toda query de listagem
-- e permite indexar direto. Corre em INSERT e UPDATE, então reingestão atualiza.
create or replace function djen_derivar_campos() returns trigger
language plpgsql
as $$
begin
  new.credor_nome      := new.destinatarios -> 0 ->> 'nome';
  new.credor_mascarado := (new.destinatarios -> 0 ->> 'mascarado') = 'true';
  new.advogado_nome    := new.destinatario_advogados -> 0 -> 'advogado' ->> 'nome';
  new.advogado_oab     := new.destinatario_advogados -> 0 -> 'advogado' ->> 'numero_oab';
  return new;
end;
$$;

drop trigger if exists trg_djen_derivar on djen_publicacoes;
create trigger trg_djen_derivar
  before insert or update on djen_publicacoes
  for each row execute function djen_derivar_campos();


-- Fundos/securitizadoras concorrentes descobertos a partir do texto das publicações.
-- Alimenta um mapa de "quem já comprou o quê na praça" e evita reconstruir por SQL.
create table djen_fundos_concorrentes (
  id                 bigserial primary key,
  nome_canonico      text        not null,
  nome_normalizado   text        not null,                  -- lowercase, sem LTDA/S.A.
  tipo               text        not null check (tipo in ('FIDC', 'SECURITIZADORA', 'PF', 'PJ_NAO_FINANCEIRA')),
  primeira_vista_em  date        not null,
  ultima_vista_em    date        not null,
  qtd_ocorrencias    integer     not null default 1,
  cnjs_amostra       text[]      not null default '{}',    -- até 5 CNJs onde apareceu
  cnpj               text,

  constraint uq_fundo_normalizado unique (nome_normalizado)
);


-- Auditoria de rodadas de ingestão. Serve pra monitorar cobertura e alertar
-- quando um tribunal-dia satura ou falha.
create table djen_ingestao_runs (
  id                 bigserial   primary key,
  iniciado_em        timestamptz not null default now(),
  finalizado_em      timestamptz,
  dia_alvo           date        not null,
  tribunal           text        not null,
  filtro_texto       text,                                  -- ex "precatório" (pré-filtro server-side)
  paginas_lidas      integer     not null default 0,
  itens_ingeridos    integer     not null default 0,
  itens_atualizados  integer     not null default 0,
  itens_ignorados    integer     not null default 0,        -- filtrados client-side (não são precatório)
  erros              jsonb       not null default '[]'::jsonb,
  saturou_teto       boolean     not null default false,    -- count == 10000 na página 1
  count_pagina_1     integer,
  status             text        not null default 'em_andamento'
    check (status in ('em_andamento', 'ok', 'falha', 'parcial'))
);

create index idx_runs_dia on djen_ingestao_runs (dia_alvo desc, tribunal);


-- RLS: apenas admin e gestão veem publicações e runs. Broker não precisa
-- (o dado dele chega via prospeccao_precatorios enriquecido).
alter table djen_publicacoes enable row level security;
alter table djen_fundos_concorrentes enable row level security;
alter table djen_ingestao_runs enable row level security;

create policy "djen_publicacoes_admin_gestao_juridico_select" on djen_publicacoes
  for select using (get_user_role() in ('admin', 'gestao', 'juridico'));

create policy "djen_publicacoes_service_all" on djen_publicacoes
  for all using (auth.jwt() ->> 'role' = 'service_role');

create policy "djen_fundos_admin_gestao_select" on djen_fundos_concorrentes
  for select using (get_user_role() in ('admin', 'gestao'));

create policy "djen_fundos_service_all" on djen_fundos_concorrentes
  for all using (auth.jwt() ->> 'role' = 'service_role');

create policy "djen_runs_admin_select" on djen_ingestao_runs
  for select using (get_user_role() in ('admin', 'gestao'));

create policy "djen_runs_service_all" on djen_ingestao_runs
  for all using (auth.jwt() ->> 'role' = 'service_role');
