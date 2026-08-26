-- Autoria dos lotes, viabilizada pelo reconhecimento da sessao do painel.
--
-- Ate aqui a autenticacao era uma senha unica no .env: ninguem sabia quem
-- disparou o que. Com a sessao do painel (server/utils/sessao-painel.ts) o
-- usuario e conhecido, e passa a ficar registrado.
--
-- O NOME e gravado junto do id, e nao so a chave: e SNAPSHOT. O relatorio
-- precisa continuar dizendo quem disparou mesmo que a pessoa saia da empresa e
-- o registro em public.users mude ou seja desativado. Pelo mesmo motivo nao ha
-- FK para public.users — aquela tabela e de outro sistema.

ALTER TABLE sys_mail_batches
  ADD COLUMN IF NOT EXISTS criado_por_user_id    integer,
  ADD COLUMN IF NOT EXISTS criado_por_nome       varchar(255),
  ADD COLUMN IF NOT EXISTS disparado_por_user_id integer,
  ADD COLUMN IF NOT EXISTS disparado_por_nome    varchar(255);
