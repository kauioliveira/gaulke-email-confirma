-- Resposta do servidor SMTP em cada envio, para depuracao.
--
-- "Enviado" significa so que o NOSSO servidor aceitou a mensagem. O que ele
-- respondeu (ex.: "250 2.0.0 Ok: queued as 4F2A1") e o que permite rastrear a
-- mensagem no log do servidor de e-mail quando o cliente diz que nao recebeu.
-- Idempotente e restrita a sys_mail_*.
alter table sys_mail_envios
  add column if not exists resposta_smtp text;
