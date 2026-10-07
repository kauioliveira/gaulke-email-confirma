-- Campos da pagina de download de um lote (lote "arquivos por cliente").
--
-- O operador escolhe o que o cliente preenche antes de baixar o arquivo:
-- texto, escolha, CPF/CNPJ, data, declaracao... — os mesmos tipos e as mesmas
-- regras dos itens da solicitacao (shared/utils/itens-solic.ts). Campo
-- obrigatorio sem resposta bloqueia a confirmacao e o download no servidor.
--
-- A resposta guarda IP e navegador, como a confirmacao: e prova do que o
-- cliente informou.
--
-- Idempotente e restrita a sys_mail_*.

create table if not exists sys_mail_batch_campos (
  id          serial primary key,
  batch_id    integer      not null references sys_mail_batches (id) on delete cascade,
  ordem       integer      not null default 0,
  tipo        varchar(20)  not null,
  titulo      varchar(200) not null default '',
  instrucao   text,
  obrigatorio boolean      not null default true,
  config      jsonb        not null default '{}'::jsonb
);

create index if not exists sys_mail_batch_campos_batch_idx on sys_mail_batch_campos (batch_id, ordem);

create table if not exists sys_mail_recipient_respostas (
  id            serial primary key,
  recipient_id  integer     not null references sys_mail_recipients (id) on delete cascade,
  campo_id      integer     not null references sys_mail_batch_campos (id) on delete cascade,
  resposta      jsonb       not null,
  respondido_em timestamptz not null default now(),
  ip            varchar(64),
  user_agent    text
);

create unique index if not exists sys_mail_recipient_respostas_idx on sys_mail_recipient_respostas (recipient_id, campo_id);
