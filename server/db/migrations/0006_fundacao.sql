-- Fundacao da plataforma: o sistema deixa de ser restrito a admin/supervisor.
--
-- Com todo usuario ativo do painel operando, "quem fez o que" passa a ser
-- obrigatorio para TODA acao, e nao so para criar e disparar lote. Por isso:
--   - sys_mail_auditoria: trilha append-only de toda alteracao;
--   - sys_mail_config: configuracoes que o admin muda pela tela, sem deploy;
--   - autoria nos templates e nas contas, que ate aqui nao registravam ninguem.
--
-- Idempotente e restrita a sys_mail_*, como as anteriores: o banco e
-- COMPARTILHADO com os outros sistemas da empresa.

create table if not exists sys_mail_auditoria (
  id          bigserial    primary key,
  quando      timestamptz  not null default now(),
  -- snapshot, sem FK para public.users (tabela de outro sistema): a trilha
  -- precisa continuar dizendo quem foi mesmo depois de a pessoa sair
  user_id     integer,
  user_nome   varchar(255),
  -- admin | supervisor | usuario, no momento da acao
  papel       varchar(20),
  -- verbo no formato entidade.acao: lote.excluir, template.editar, conta.criar
  acao        varchar(60)  not null,
  entidade    varchar(40),
  entidade_id varchar(64),
  -- frase pronta para a tela: 'Excluiu o lote "Guias DAS" (312 destinatarios)'
  resumo      text         not null,
  -- antes/depois dos campos alterados; NUNCA senhas
  dados       jsonb,
  ip          varchar(64),
  user_agent  text
);

create index if not exists sys_mail_auditoria_quando_idx   on sys_mail_auditoria (quando desc);
create index if not exists sys_mail_auditoria_entidade_idx on sys_mail_auditoria (entidade, entidade_id);
create index if not exists sys_mail_auditoria_user_idx     on sys_mail_auditoria (user_id);
create index if not exists sys_mail_auditoria_acao_idx     on sys_mail_auditoria (acao);

-- Chave/valor. jsonb para cada chave guardar o tipo que precisar (booleano,
-- numero, objeto) sem uma coluna por configuracao.
create table if not exists sys_mail_config (
  chave               varchar(80)  primary key,
  valor               jsonb        not null,
  atualizado_por_nome varchar(255),
  atualizado_em       timestamptz  not null default now()
);

-- A senha local continua valendo ate um admin desligar: mudar o comportamento
-- no deploy deixaria sem acesso quem entra por IP no desenvolvimento.
insert into sys_mail_config (chave, valor, atualizado_por_nome)
values ('senha_local_habilitada', 'true'::jsonb, 'migracao 0006')
on conflict (chave) do nothing;

alter table sys_mail_templates
  add column if not exists criado_por_user_id     integer,
  add column if not exists criado_por_nome        varchar(255),
  add column if not exists atualizado_por_user_id integer,
  add column if not exists atualizado_por_nome    varchar(255);

alter table sys_mail_accounts
  add column if not exists atualizado_por_nome varchar(255);
