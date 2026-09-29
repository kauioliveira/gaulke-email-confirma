-- Templates para o usuario comum: versoes, tipo e classificacao.
--
-- Idempotente e restrita a sys_mail_*, como as anteriores: o banco e
-- COMPARTILHADO com os outros sistemas da empresa.

-- Historico de versoes: cada salvamento guarda uma copia completa. Os lotes ja
-- guardam o snapshot do que foi enviado, entao isto existe para DESFAZER uma
-- edicao ruim do template, e nao para o relatorio.
create table if not exists sys_mail_template_versoes (
  id                 bigserial    primary key,
  template_id        integer      not null references sys_mail_templates(id) on delete cascade,
  versao             integer      not null,
  nome               varchar(160) not null,
  assunto            varchar(300) not null,
  formato            varchar(10)  not null,
  blocos             jsonb,
  html               text         not null,
  tipo               varchar(20),
  categoria          varchar(60),
  salvo_por_user_id  integer,
  salvo_por_nome     varchar(255),
  salvo_em           timestamptz  not null default now()
);
create unique index if not exists sys_mail_template_versoes_idx
  on sys_mail_template_versoes (template_id, versao);

-- Tipo dos templates que ja existem, deduzido do conteudo: com botao de
-- acesso (ou {{link}} no HTML livre) e documento; sem, e comunicado.
update sys_mail_templates
   set tipo = case
     when formato = 'blocos' and blocos is not null
          and exists (select 1 from jsonb_array_elements(blocos) b where b->>'tipo' = 'botao')
       then 'documento'
     when formato = 'html' and html like '%{{link}}%' then 'documento'
     else 'comunicado'
   end
 where tipo is null;

-- A versao 1 de cada template existente e o estado de hoje.
insert into sys_mail_template_versoes
  (template_id, versao, nome, assunto, formato, blocos, html, tipo, categoria,
   salvo_por_user_id, salvo_por_nome, salvo_em)
select t.id, 1, t.nome, t.assunto, t.formato, t.blocos, t.html, t.tipo, t.categoria,
       coalesce(t.atualizado_por_user_id, t.criado_por_user_id),
       coalesce(t.atualizado_por_nome, t.criado_por_nome),
       t.updated_at
  from sys_mail_templates t
 where not exists (select 1 from sys_mail_template_versoes v where v.template_id = t.id);
