-- Comunicacao 2.0: arquivar, lixeira, "responder para", reenvio individual.
--
-- Idempotente e restrita a sys_mail_*, como as anteriores: o banco e
-- COMPARTILHADO com os outros sistemas da empresa.

-- ---------------------------------------------------------------------------
-- Lotes
-- ---------------------------------------------------------------------------
alter table sys_mail_batches
  -- arquivar e so organizacao da lista: o destinatario nao percebe nada
  add column if not exists arquivado_em        timestamptz,
  add column if not exists arquivado_por_nome  varchar(255),
  -- exclusao LOGICA (lixeira): o lote some das telas e os links param, mas
  -- destinatarios e eventos — a prova de entrega — continuam guardados
  add column if not exists excluido_em         timestamptz,
  add column if not exists excluido_por_nome   varchar(255),
  add column if not exists excluido_motivo     text,
  -- "Respostas para" escolhido no envio; nulo = o reply-to do proprio canal
  add column if not exists responder_para      varchar(300),
  -- abrir ticket no painel para respostas/falta de confirmacao (Fase 3)
  add column if not exists criar_tickets       boolean not null default false;

create index if not exists sys_mail_batches_excluido_idx
  on sys_mail_batches (excluido_em) where excluido_em is not null;
create index if not exists sys_mail_batches_arquivado_idx
  on sys_mail_batches (arquivado_em) where arquivado_em is not null;

-- ---------------------------------------------------------------------------
-- Templates (usados pela Fase 2; as colunas entram agora para o schema nao
-- mudar duas vezes)
-- ---------------------------------------------------------------------------
alter table sys_mail_templates
  add column if not exists tipo         varchar(20),   -- documento | comunicado
  add column if not exists categoria    varchar(60),
  add column if not exists oficial      boolean not null default false,
  add column if not exists arquivado_em timestamptz;

-- ---------------------------------------------------------------------------
-- Envios: cada vez que um e-mail sai para um destinatario
-- ---------------------------------------------------------------------------
-- O destinatario guardava so o ULTIMO envio (sent_at, message_id). Com o
-- reenvio individual ("o cliente diz que nao recebeu") passa a haver varios,
-- e cada um precisa dizer quem reenviou, para qual endereco, por qual canal e
-- por que. E tambem o que liga uma resposta do cliente ao envio certo (Fase 3,
-- pelo message_id).
create table if not exists sys_mail_envios (
  id                   bigserial    primary key,
  recipient_id         integer      not null references sys_mail_recipients(id) on delete cascade,
  -- 1 = envio original do lote; 2, 3... = reenvios
  numero               integer      not null,
  -- lote | reenvio
  origem               varchar(20)  not null default 'lote',
  para                 varchar(320) not null,
  message_id           text,
  conta_id             integer,
  conta_nome           varchar(120),
  responder_para       varchar(300),
  -- enviado | erro
  status               varchar(20)  not null,
  erro                 text,
  motivo               text,
  enviado_por_user_id  integer,
  enviado_por_nome     varchar(255),
  enviado_em           timestamptz  not null default now()
);

create unique index if not exists sys_mail_envios_numero_idx on sys_mail_envios (recipient_id, numero);
create index if not exists sys_mail_envios_message_idx on sys_mail_envios (message_id);

-- Backfill: o envio que ja aconteceu vira o envio no 1 de cada destinatario.
-- Quem disparou o lote e quem "enviou"; a conta e a do lote.
insert into sys_mail_envios
  (recipient_id, numero, origem, para, message_id, conta_id, conta_nome, status,
   enviado_por_user_id, enviado_por_nome, enviado_em)
select r.id, 1, 'lote', r.email, r.message_id, b.conta_id, b.conta_nome, 'enviado',
       b.disparado_por_user_id, b.disparado_por_nome, r.sent_at
  from sys_mail_recipients r
  join sys_mail_batches b on b.id = r.batch_id
 where r.sent_at is not null
   and not exists (select 1 from sys_mail_envios e where e.recipient_id = r.id);

-- Reenvio pela fila do lote ("reenviar para quem nao confirmou"): o pedido
-- (motivo, quem pediu) fica aqui ate o worker enviar e registrar o envio.
alter table sys_mail_recipients
  add column if not exists reenvio_pendente jsonb;

-- ---------------------------------------------------------------------------
-- Servidor SMTP padrao dos canais novos
-- ---------------------------------------------------------------------------
-- O servidor costuma ser o mesmo para todas as caixas; so usuario e senha
-- mudam. Parte do canal padrao atual, se houver.
insert into sys_mail_config (chave, valor, atualizado_por_nome)
select 'smtp_servidor_padrao',
       jsonb_build_object(
         'host', a.host,
         'port', a.port,
         'secure', a.secure = 'true',
         'requireTls', a.require_tls = 'true',
         'rejectUnauthorized', a.reject_unauthorized = 'true'
       ),
       'migracao 0007 (a partir do canal padrao)'
  from sys_mail_accounts a
 where a.padrao = 'true'
 limit 1
on conflict (chave) do nothing;
