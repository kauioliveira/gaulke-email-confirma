-- Estrutura inicial do sistema de envio e confirmacao.
-- Idempotente de proposito: este banco e COMPARTILHADO com outros sistemas
-- da empresa, entao toda instrucao aqui so pode criar objetos sys_mail_*.
-- Nunca use `drizzle-kit push` contra este banco: ele compara o schema
-- inteiro e gera DROP das tabelas dos outros sistemas.

CREATE TABLE IF NOT EXISTS sys_mail_templates (
  id          serial PRIMARY KEY,
  nome        varchar(160) NOT NULL,
  assunto     varchar(300) NOT NULL,
  html        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sys_mail_batches (
  id                 serial PRIMARY KEY,
  nome               varchar(200) NOT NULL,
  template_id        integer REFERENCES sys_mail_templates(id) ON DELETE SET NULL,
  assunto_snapshot   varchar(300) NOT NULL,
  html_snapshot      text NOT NULL,
  arquivo_path       text,
  arquivo_nome       varchar(260),
  intervalo_ms       integer NOT NULL DEFAULT 10000,
  exigir_confirmacao varchar(5) NOT NULL DEFAULT 'true',
  status             varchar(20) NOT NULL DEFAULT 'rascunho',
  total              integer NOT NULL DEFAULT 0,
  enviados           integer NOT NULL DEFAULT 0,
  falhas             integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz
);
CREATE INDEX IF NOT EXISTS sys_mail_batches_status_idx ON sys_mail_batches (status);

CREATE TABLE IF NOT EXISTS sys_mail_recipients (
  id                serial PRIMARY KEY,
  batch_id          integer NOT NULL REFERENCES sys_mail_batches(id) ON DELETE CASCADE,
  nome              varchar(200),
  email             varchar(320) NOT NULL,
  empresa           varchar(200),
  dados_extras      jsonb,
  token             varchar(36) NOT NULL,
  codigo            varchar(20) NOT NULL,
  status            varchar(20) NOT NULL DEFAULT 'pendente',
  tentativas        integer NOT NULL DEFAULT 0,
  ultimo_erro       text,
  message_id        text,
  sent_at           timestamptz,
  first_open_at     timestamptz,
  first_access_at   timestamptz,
  confirmed_at      timestamptz,
  first_download_at timestamptz,
  download_count    integer NOT NULL DEFAULT 0,
  locked_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_mail_recipients_token_idx        ON sys_mail_recipients (token);
CREATE UNIQUE INDEX IF NOT EXISTS sys_mail_recipients_codigo_idx       ON sys_mail_recipients (codigo);
CREATE INDEX        IF NOT EXISTS sys_mail_recipients_batch_idx        ON sys_mail_recipients (batch_id);
CREATE INDEX        IF NOT EXISTS sys_mail_recipients_batch_status_idx ON sys_mail_recipients (batch_id, status);
CREATE INDEX        IF NOT EXISTS sys_mail_recipients_email_idx        ON sys_mail_recipients (email);

CREATE TABLE IF NOT EXISTS sys_mail_events (
  id           serial PRIMARY KEY,
  recipient_id integer NOT NULL REFERENCES sys_mail_recipients(id) ON DELETE CASCADE,
  tipo         varchar(20) NOT NULL,
  ip           varchar(64),
  user_agent   text,
  referer      text,
  meta         jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sys_mail_events_recipient_idx ON sys_mail_events (recipient_id);
CREATE INDEX IF NOT EXISTS sys_mail_events_created_idx   ON sys_mail_events (created_at);
CREATE INDEX IF NOT EXISTS sys_mail_events_tipo_idx      ON sys_mail_events (tipo);
