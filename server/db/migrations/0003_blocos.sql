-- Editor visual de e-mail (blocos).
--
-- O HTML continua sendo a fonte para o ENVIO: ao salvar um template em modo
-- blocos, o sistema gera o html a partir deles. Assim preview, criacao de
-- lote, disparo e relatorio seguem funcionando sem nenhuma alteracao.
-- Os blocos sao a representacao EDITAVEL, guardada ao lado.
--
-- Idempotente e restrita a sys_mail_*, como as anteriores.

ALTER TABLE sys_mail_templates
  ADD COLUMN IF NOT EXISTS formato varchar(10) NOT NULL DEFAULT 'html',
  ADD COLUMN IF NOT EXISTS blocos  jsonb;

-- O lote guarda o snapshot dos blocos junto do html_snapshot: permite reabrir
-- no editor visual um e-mail ja disparado, sem perder o html exato que saiu.
ALTER TABLE sys_mail_batches
  ADD COLUMN IF NOT EXISTS formato varchar(10) NOT NULL DEFAULT 'html',
  ADD COLUMN IF NOT EXISTS blocos  jsonb;
