-- Agendamento de disparo.
--
-- Idempotente e restrita a sys_mail_*, como as anteriores: este banco e
-- COMPARTILHADO com os outros sistemas da empresa.

ALTER TABLE sys_mail_batches
  ADD COLUMN IF NOT EXISTS agendado_para timestamptz,
  ADD COLUMN IF NOT EXISTS agendado_em   timestamptz,
  -- motivo quando o proprio sistema muda o status do lote (ex.: agendamento
  -- vencido enquanto a aplicacao estava fora do ar). Sem este campo nao havia
  -- onde explicar para o operador por que o lote parou.
  ADD COLUMN IF NOT EXISTS observacao    text;

-- indice parcial: a varredura do agendador so olha lotes com data marcada
CREATE INDEX IF NOT EXISTS sys_mail_batches_agendado_idx
  ON sys_mail_batches (agendado_para)
  WHERE agendado_para IS NOT NULL;
