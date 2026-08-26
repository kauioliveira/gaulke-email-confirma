-- Rastreamento de abertura mais honesto.
--
-- Ate aqui so guardavamos a PRIMEIRA abertura, sem distinguir a pessoa do
-- pre-carregamento automatico feito por Apple Mail, Gmail e antivirus.
-- Agora contamos todas e separamos maquina de provavel pessoa.

ALTER TABLE sys_mail_recipients
  ADD COLUMN IF NOT EXISTS open_count          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_open_at        timestamptz,
  -- primeira abertura que NAO parece pre-carregamento de maquina
  ADD COLUMN IF NOT EXISTS first_human_open_at timestamptz;

-- Confirmacao de leitura pedida pelo proprio cliente de e-mail
-- (Disposition-Notification-To). Opcional por lote: a maioria dos clientes
-- ignora o cabecalho e quem ve costuma achar invasivo.
ALTER TABLE sys_mail_batches
  ADD COLUMN IF NOT EXISTS pedir_recibo varchar(5) NOT NULL DEFAULT 'false';

-- Backfill: aberturas ja registradas contam como 1, sem classificacao
UPDATE sys_mail_recipients
   SET open_count = 1, last_open_at = first_open_at
 WHERE first_open_at IS NOT NULL AND open_count = 0;
