-- Anexo individual: cada destinatario pode receber o SEU arquivo (guia DAS,
-- holerite, informe) em vez de um arquivo unico para o lote todo.
--
-- Idempotente e restrita a sys_mail_*.

alter table sys_mail_recipients
  -- CPF/CNPJ so com digitos: e por ele que o arquivo e casado com a pessoa
  add column if not exists documento    varchar(20),
  -- o arquivo DESTA pessoa (no storage privado); nulo = o do lote, se houver
  add column if not exists arquivo_path text,
  add column if not exists arquivo_nome varchar(260);

alter table sys_mail_batches
  -- nenhum (comunicado) | unico (um arquivo para todos) | individual
  add column if not exists modo_anexo varchar(15) not null default 'nenhum';

-- lotes antigos: com arquivo = unico
update sys_mail_batches set modo_anexo = 'unico'
 where arquivo_path is not null and modo_anexo = 'nenhum';
