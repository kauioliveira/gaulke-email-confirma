-- Visibilidade por setor: solicitacoes, assinaturas, templates e modelos de
-- checklist guardam o setor (public.department, do painel). Admin ve tudo;
-- os demais, so o proprio setor.
--
-- Sem FK para public.department de proposito: a tabela e de outro sistema e
-- este banco e compartilhado (veja server/api/admin/pessoas.get.ts).
--
-- Idempotente e restrita a sys_mail_*.

alter table sys_mail_solic add column if not exists departamento_id integer;
alter table sys_mail_assin_documentos add column if not exists departamento_id integer;
-- nulo = todos os setores
alter table sys_mail_templates add column if not exists departamento_id integer;
alter table sys_mail_checklists add column if not exists departamento_id integer;

create index if not exists sys_mail_solic_departamento_idx on sys_mail_solic (departamento_id);
create index if not exists sys_mail_assin_documentos_departamento_idx on sys_mail_assin_documentos (departamento_id);

-- o que ja existe vai para o setor ATUAL de quem criou
update sys_mail_solic s
   set departamento_id = u.department_id
  from public.users u
 where u.id = s.criado_por_user_id
   and s.departamento_id is null;

update sys_mail_assin_documentos d
   set departamento_id = u.department_id
  from public.users u
 where u.id = d.criado_por_user_id
   and d.departamento_id is null;

-- modelos: o `setor` era texto livre ("DP", "Fiscal"...); vira o setor do cadastro
update sys_mail_checklists c
   set departamento_id = d.id
  from public.department d
 where c.departamento_id is null
   and c.setor is not null
   and (lower(d.name) = lower(trim(c.setor))
        or (upper(trim(c.setor)) = 'DP' and d.name = 'Pessoal'));

-- templates existentes ficam para todos os setores: nada some da tela de ninguem
