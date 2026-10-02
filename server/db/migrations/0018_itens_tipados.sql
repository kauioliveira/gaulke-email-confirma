-- Itens tipados nas solicitacoes: alem do envio de arquivo ("documento"), o
-- modelo pode pedir texto, escolha entre alternativas, campos validados
-- (e-mail, telefone, CPF/CNPJ, data, numero, valor) e declaracao/aceite.
--
-- tipo/config valem para o modelo e para a copia em cada solicitacao; a
-- resposta do cliente fica no item da solicitacao. As regras de cada tipo
-- estao em shared/utils/itens-solic.ts.
--
-- Prova da declaracao: respondido_em + resposta_ip + resposta_user_agent e o
-- sha-256 do texto aceito (dentro de resposta).
--
-- Idempotente e restrita a sys_mail_*. O que ja existe vira "documento".

alter table sys_mail_checklist_itens add column if not exists tipo varchar(20) not null default 'documento';
alter table sys_mail_checklist_itens add column if not exists config jsonb not null default '{}'::jsonb;

alter table sys_mail_solic_itens add column if not exists tipo varchar(20) not null default 'documento';
alter table sys_mail_solic_itens add column if not exists config jsonb not null default '{}'::jsonb;
alter table sys_mail_solic_itens add column if not exists resposta jsonb;
alter table sys_mail_solic_itens add column if not exists respondido_em timestamptz;
alter table sys_mail_solic_itens add column if not exists resposta_ip varchar(64);
alter table sys_mail_solic_itens add column if not exists resposta_user_agent text;
