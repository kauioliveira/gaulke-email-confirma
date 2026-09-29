-- Fase 8: retencao LGPD e extras — listas de contatos salvas, lembretes
-- automaticos nos comunicados, webhooks (n8n) e o monitor da caixa ligando
-- respostas as solicitacoes e assinaturas.
--
-- Idempotente e restrita a sys_mail_*.

-- ---------------------------------------------------------------------------
-- Listas de contatos salvas ("Clientes do Simples", "DP - folha")
-- ---------------------------------------------------------------------------
create table if not exists sys_mail_listas (
  id                   serial       primary key,
  nome                 varchar(160) not null,
  descricao            text,
  criado_por_user_id   integer,
  criado_por_nome      varchar(255),
  atualizado_por_nome  varchar(255),
  criado_em            timestamptz  not null default now(),
  atualizado_em        timestamptz  not null default now()
);
create unique index if not exists sys_mail_listas_nome_idx on sys_mail_listas (lower(nome));

create table if not exists sys_mail_lista_membros (
  id             serial       primary key,
  lista_id       integer      not null references sys_mail_listas(id) on delete cascade,
  email          varchar(320) not null,
  nome           varchar(200),
  empresa        varchar(200),
  -- CPF/CNPJ, so digitos: casa o anexo individual e abre a pasta do cliente
  documento      varchar(20),
  -- colunas a mais da planilha, usadas como variaveis no e-mail
  extras         jsonb,
  adicionado_em  timestamptz  not null default now()
);
create unique index if not exists sys_mail_lista_membros_idx on sys_mail_lista_membros (lista_id, email);
create index if not exists sys_mail_lista_membros_email_idx on sys_mail_lista_membros (email);

-- ---------------------------------------------------------------------------
-- Lembrete automatico nos comunicados: a cada N dias para quem nao confirmou
-- ---------------------------------------------------------------------------
alter table sys_mail_batches    add column if not exists lembrete_dias integer;
alter table sys_mail_batches    add column if not exists lembrete_max  integer not null default 0;
alter table sys_mail_recipients add column if not exists lembretes_enviados integer not null default 0;
alter table sys_mail_recipients add column if not exists ultimo_lembrete_em timestamptz;

-- ---------------------------------------------------------------------------
-- Monitor da caixa: respostas e devolucoes de solicitacoes e assinaturas
-- ---------------------------------------------------------------------------
alter table sys_mail_inbound add column if not exists solic_id integer
  references sys_mail_solic(id) on delete set null;
alter table sys_mail_inbound add column if not exists assin_documento_id integer
  references sys_mail_assin_documentos(id) on delete set null;
alter table sys_mail_inbound add column if not exists assin_signatario_id integer
  references sys_mail_assin_signatarios(id) on delete set null;
create index if not exists sys_mail_inbound_solic_idx on sys_mail_inbound (solic_id) where solic_id is not null;
create index if not exists sys_mail_inbound_assin_idx on sys_mail_inbound (assin_documento_id) where assin_documento_id is not null;
create index if not exists sys_mail_inbound_recebido_idx on sys_mail_inbound (processado_em);

-- ---------------------------------------------------------------------------
-- Webhooks (n8n e afins): quem ouve quais eventos, e a fila de entregas
-- ---------------------------------------------------------------------------
create table if not exists sys_mail_webhooks (
  id                   serial       primary key,
  nome                 varchar(120) not null,
  url                  text         not null,
  -- nomes dos eventos ('assinatura.concluida'...) ou '*' para todos
  eventos              text[]       not null default '{}',
  -- segredo do HMAC, CIFRADO; mostrado uma vez so, na criacao
  segredo_cifrado      text         not null,
  ativo                boolean      not null default true,
  ultima_entrega_em    timestamptz,
  ultimo_status        integer,
  ultimo_erro          text,
  criado_por_nome      varchar(255),
  atualizado_por_nome  varchar(255),
  criado_em            timestamptz  not null default now(),
  atualizado_em        timestamptz  not null default now()
);

create table if not exists sys_mail_webhook_entregas (
  id                    bigserial    primary key,
  webhook_id            integer      not null references sys_mail_webhooks(id) on delete cascade,
  -- identificador estavel entre tentativas: o n8n usa para descartar repetidas
  entrega_uuid          uuid         not null,
  evento                varchar(60)  not null,
  payload               jsonb        not null,
  -- pendente | entregue | erro (desistiu depois das tentativas)
  status                varchar(20)  not null default 'pendente',
  tentativas            integer      not null default 0,
  proxima_tentativa_em  timestamptz  not null default now(),
  ultimo_status_http    integer,
  ultimo_erro           text,
  criado_em             timestamptz  not null default now(),
  entregue_em           timestamptz
);
create index if not exists sys_mail_webhook_entregas_fila_idx
  on sys_mail_webhook_entregas (proxima_tentativa_em) where status = 'pendente';
create index if not exists sys_mail_webhook_entregas_webhook_idx
  on sys_mail_webhook_entregas (webhook_id, criado_em desc);
