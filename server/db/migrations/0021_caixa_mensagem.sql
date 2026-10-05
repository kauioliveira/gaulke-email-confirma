-- E-mail recebido completo: quem nao tem acesso a caixa do canal precisa ler a
-- resposta do cliente (com os anexos) e responder pelo proprio sistema.
--
-- So e guardado o que se liga a um envio nosso e e RESPOSTA de gente (mesma
-- regra que ja decidia guardar o trecho). Sem vinculo, continua so
-- remetente e assunto.
--
-- Arquivos ficam em documentos/caixa/<ano>/<id>/ (o .eml original e os anexos);
-- a retencao e a exclusao da solicitacao apagam a pasta junto com a linha.
--
-- Idempotente e restrita a sys_mail_*.

alter table sys_mail_inbound add column if not exists para text;
alter table sys_mail_inbound add column if not exists referencias text;
alter table sys_mail_inbound add column if not exists corpo_texto text;
alter table sys_mail_inbound add column if not exists corpo_html text;
alter table sys_mail_inbound add column if not exists pasta text;
alter table sys_mail_inbound add column if not exists tamanho integer;
-- [{ nome, tipo, tamanho, arquivo, sha256 }]
alter table sys_mail_inbound add column if not exists anexos jsonb;

-- respostas que a equipe mandou ao cliente pelo sistema
create table if not exists sys_mail_inbound_respostas (
  id                  bigserial primary key,
  inbound_id          bigint not null references sys_mail_inbound (id) on delete cascade,
  para                varchar(320) not null,
  assunto             varchar(500) not null,
  texto               text not null,
  anexos              jsonb,
  message_id          text,
  enviado_por_user_id integer,
  enviado_por_nome    varchar(255),
  enviado_em          timestamptz,
  erro                text,
  criado_em           timestamptz not null default now()
);
create index if not exists sys_mail_inbound_respostas_inbound_idx on sys_mail_inbound_respostas (inbound_id);
