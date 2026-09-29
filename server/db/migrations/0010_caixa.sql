-- Monitor da caixa de e-mail (IMAP) + chamados no painel + supressao.
--
-- "Enviado" so quer dizer que o nosso servidor aceitou a mensagem. O que
-- acontece DEPOIS — devolucao, recibo de leitura, resposta do cliente — chega
-- como e-mail na caixa do canal. O monitor le essa caixa (SO LE: nunca move,
-- apaga ou marca como lida) e liga cada mensagem ao envio que a originou.
--
-- Idempotente e restrita a sys_mail_*.

-- ---------------------------------------------------------------------------
-- Canal: leitura da caixa e flags
-- ---------------------------------------------------------------------------
alter table sys_mail_accounts
  add column if not exists monitorar_caixa        boolean      not null default false,
  -- nulo = o mesmo host do SMTP (servidor interno: mesma maquina, mesmas credenciais)
  add column if not exists imap_host              varchar(200),
  add column if not exists imap_port              integer      not null default 993,
  add column if not exists imap_secure            boolean      not null default true,
  -- abrir chamado no painel (resposta de cliente / sem confirmacao em N dias)
  add column if not exists criar_tickets          boolean      not null default false,
  add column if not exists dias_sem_confirmacao   integer      not null default 3,
  -- onde a leitura parou: so o que chegou depois disso e processado
  add column if not exists imap_uidvalidity       bigint,
  add column if not exists imap_ultimo_uid        bigint,
  add column if not exists imap_ultima_leitura_em timestamptz,
  add column if not exists imap_ultimo_erro       text,
  add column if not exists imap_ultimo_erro_em    timestamptz;

-- ---------------------------------------------------------------------------
-- Destinatario: o que voltou
-- ---------------------------------------------------------------------------
alter table sys_mail_recipients
  add column if not exists bounce_at      timestamptz,
  -- definitiva (5.x.x: endereco/dominio nao existe) | temporaria (4.x.x)
  add column if not exists bounce_tipo    varchar(20),
  add column if not exists bounce_motivo  text,
  add column if not exists respondeu_at   timestamptz,
  add column if not exists resposta_count integer not null default 0,
  add column if not exists recibo_at      timestamptz;

create index if not exists sys_mail_recipients_message_idx on sys_mail_recipients (message_id);

-- ---------------------------------------------------------------------------
-- Mensagens lidas da caixa
-- ---------------------------------------------------------------------------
-- A caixa pode ter e-mail que nao tem nada a ver com os envios. Desses, so
-- remetente e assunto sao guardados (para a tela "sem vinculo"); o trecho do
-- corpo so e guardado quando a mensagem se liga a um envio.
create table if not exists sys_mail_inbound (
  id             bigserial    primary key,
  conta_id       integer      references sys_mail_accounts(id) on delete set null,
  conta_nome     varchar(120),
  uidvalidity    bigint       not null,
  uid            bigint       not null,
  message_id     text,
  de             text,
  assunto        text,
  recebido_em    timestamptz,
  -- devolucao_definitiva | devolucao_temporaria | recibo | auto_resposta | resposta
  classificacao  varchar(30)  not null,
  recipient_id   integer      references sys_mail_recipients(id) on delete set null,
  batch_id       integer      references sys_mail_batches(id) on delete set null,
  -- como a mensagem foi ligada ao envio (message_id, cabecalho, codigo, token)
  vinculo        varchar(30),
  trecho         text,
  detalhe        jsonb,
  processado_em  timestamptz  not null default now()
);
create unique index if not exists sys_mail_inbound_uid_idx on sys_mail_inbound (conta_id, uidvalidity, uid);
create index if not exists sys_mail_inbound_recipient_idx on sys_mail_inbound (recipient_id);
create index if not exists sys_mail_inbound_processado_idx on sys_mail_inbound (processado_em desc);

-- ---------------------------------------------------------------------------
-- Fila de chamados no painel
-- ---------------------------------------------------------------------------
-- O painel pode estar fora do ar na hora: o pedido fica aqui e e tentado de
-- novo, com espera crescente, ate dar certo.
create table if not exists sys_mail_tickets (
  id                  bigserial    primary key,
  -- resposta | sem_confirmacao
  motivo              varchar(30)  not null,
  batch_id            integer      references sys_mail_batches(id) on delete cascade,
  recipient_id        integer      references sys_mail_recipients(id) on delete cascade,
  inbound_id          bigint       references sys_mail_inbound(id) on delete set null,
  solicitante_user_id integer,
  titulo              varchar(255) not null,
  descricao           text         not null,
  external_code       varchar(120) not null,
  external_url        text,
  -- preenchidos quando o chamado existe no painel
  ticket_uuid         uuid,
  ticket_code         varchar(40),
  -- abrir (chamado novo) | comentar (resposta nova num chamado aberto)
  acao                varchar(20),
  -- pendente | criado | comentado | erro
  status_envio        varchar(20)  not null default 'pendente',
  tentativas          integer      not null default 0,
  erro                text,
  proxima_tentativa_em timestamptz not null default now(),
  criado_em           timestamptz  not null default now(),
  atualizado_em       timestamptz  not null default now()
);
create index if not exists sys_mail_tickets_fila_idx on sys_mail_tickets (status_envio, proxima_tentativa_em);
create index if not exists sys_mail_tickets_recipient_idx on sys_mail_tickets (recipient_id, motivo);
-- um so chamado de "sem confirmacao" por lote
create unique index if not exists sys_mail_tickets_sem_conf_idx on sys_mail_tickets (batch_id) where motivo = 'sem_confirmacao';

-- ---------------------------------------------------------------------------
-- Supressao: enderecos que devolveram definitivamente
-- ---------------------------------------------------------------------------
create table if not exists sys_mail_supressao (
  email          varchar(320) primary key,
  motivo         text,
  -- devolucao | manual
  origem         varchar(30)  not null,
  recipient_id   integer      references sys_mail_recipients(id) on delete set null,
  criado_em      timestamptz  not null default now(),
  criado_por_nome varchar(255)
);
