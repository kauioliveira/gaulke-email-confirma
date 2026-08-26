-- Contas de envio: o SMTP deixa de morar so no .env.
--
-- O servidor costuma ser sempre o mesmo, mas usuario e senha mudam por setor,
-- entao cada conta guarda o conjunto inteiro. A senha vai CIFRADA (AES-256-GCM,
-- server/utils/cripto.ts) porque o SMTP precisa dela em claro na hora de
-- autenticar — hash nao serve aqui, e de via unica.
--
-- Idempotente de proposito: este arquivo roda no boot em qualquer ambiente.

create table if not exists sys_mail_accounts (
  id                  serial primary key,
  nome                varchar(120) not null,
  host                varchar(200) not null,
  port                integer      not null default 587,
  secure              varchar(5)   not null default 'false',
  require_tls         varchar(5)   not null default 'true',
  reject_unauthorized varchar(5)   not null default 'true',
  usuario             varchar(200) not null,
  -- v1:<iv>:<tag>:<texto cifrado>, tudo em base64url
  senha_cifrada       text         not null,
  remetente           varchar(300) not null,
  responder_para      varchar(300),
  ativa               varchar(5)   not null default 'true',
  -- conta pre-selecionada no disparo; garantida unica pelo indice abaixo
  padrao              varchar(5)   not null default 'false',
  -- resultado do ultimo teste de conexao, para a tela nao mentir sobre o estado
  ultimo_teste_em     timestamptz,
  ultimo_teste_ok     varchar(5),
  ultimo_teste_msg    text,
  criado_por_nome     varchar(255),
  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now()
);

create unique index if not exists sys_mail_accounts_nome_idx on sys_mail_accounts (lower(nome));
-- so uma conta padrao: o indice parcial impede duas ao mesmo tempo no banco,
-- e nao so no codigo
create unique index if not exists sys_mail_accounts_padrao_idx
  on sys_mail_accounts (padrao) where padrao = 'true';

-- De qual conta o lote saiu. Fica no lote, e nao no destinatario, porque o
-- disparo inteiro usa uma so; e o nome vai junto para o relatorio sobreviver
-- a exclusao da conta.
alter table sys_mail_batches add column if not exists conta_id   integer;
alter table sys_mail_batches add column if not exists conta_nome varchar(120);

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
     where constraint_name = 'sys_mail_batches_conta_id_fkey'
  ) then
    alter table sys_mail_batches
      add constraint sys_mail_batches_conta_id_fkey
      foreign key (conta_id) references sys_mail_accounts (id) on delete set null;
  end if;
end $$;
