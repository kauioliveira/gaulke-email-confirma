-- Contatos por empresa: qual e-mail costuma receber pelo CPF/CNPJ.
--
-- A tabela company (de outro sistema) tem razao social e CNPJ, mas nao tem
-- e-mail. Este cadastro aprende com os envios: cada lote ou solicitacao com
-- documento + e-mail soma um uso. Ao escolher a empresa na tela, os e-mails
-- mais recentes aparecem como sugestao.
--
-- removido_em = "esquecer este e-mail" (associacao errada), sem apagar.
-- Um envio novo para o mesmo par traz o contato de volta.
--
-- Idempotente e restrita a sys_mail_*.

create table if not exists sys_mail_empresa_contatos (
  id           serial primary key,
  documento    varchar(14)  not null,   -- so digitos: CPF (11) ou CNPJ (14)
  email        varchar(320) not null,   -- minusculo
  nome         varchar(200),
  empresa      varchar(200),
  origem       varchar(20)  not null,   -- historico | lote | solicitacao
  usos         integer      not null default 1,
  primeiro_uso timestamptz  not null default now(),
  ultimo_uso   timestamptz  not null default now(),
  removido_em  timestamptz
);

create unique index if not exists sys_mail_empresa_contatos_doc_email_idx on sys_mail_empresa_contatos (documento, email);
create index if not exists sys_mail_empresa_contatos_email_idx on sys_mail_empresa_contatos (email);

-- carga inicial: tudo o que ja foi enviado com documento
insert into sys_mail_empresa_contatos (documento, email, nome, empresa, origem, usos, primeiro_uso, ultimo_uso)
select doc,
       email,
       (array_agg(nome order by quando desc) filter (where nome is not null and nome <> ''))[1],
       (array_agg(empresa order by quando desc) filter (where empresa is not null and empresa <> ''))[1],
       'historico',
       count(*),
       min(quando),
       max(quando)
  from (
    select regexp_replace(documento, '\D', '', 'g') as doc, lower(trim(email)) as email, nome, empresa,
           coalesce(sent_at, created_at) as quando
      from sys_mail_recipients
     where documento is not null
    union all
    select regexp_replace(documento, '\D', '', 'g'), lower(trim(destinatario_email)), destinatario_nome, empresa, created_at
      from sys_mail_solic
     where documento is not null
    union all
    select regexp_replace(documento, '\D', '', 'g'), lower(trim(email)), nome, empresa, adicionado_em
      from sys_mail_lista_membros
     where documento is not null
  ) x
 where doc ~ '^(\d{11}|\d{14})$'
   and email like '%@%'
 group by doc, email
on conflict (documento, email) do nothing;
