-- Chamados no painel tambem para as SOLICITACOES: quando o cliente responde o
-- e-mail do pedido, abre (ou comenta) um chamado em nome de quem pediu, como
-- ja acontece nos lotes com "criar chamados" ligado.
--
-- criar_tickets e escolhido no ultimo passo da nova solicitacao (o padrao vem
-- do canal). As que ja existem seguem o canal delas.
--
-- Idempotente e restrita a sys_mail_*.

alter table sys_mail_solic add column if not exists criar_tickets boolean not null default false;

alter table sys_mail_tickets add column if not exists solic_id integer references sys_mail_solic (id) on delete cascade;
create index if not exists sys_mail_tickets_solic_idx on sys_mail_tickets (solic_id);

update sys_mail_solic s
   set criar_tickets = true
  from sys_mail_accounts a
 where a.id = coalesce(s.conta_id, (select id from sys_mail_accounts where padrao = 'true' order by id limit 1))
   and a.criar_tickets
   and not s.criar_tickets;
