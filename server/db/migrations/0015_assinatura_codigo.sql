-- Assinaturas: codigo publico aleatorio e signatario pessoa juridica.
--
-- O codigo ASS-000034 saia do id da tabela e revelava quantos documentos a
-- Gaulke ja mandou assinar. Agora e ASS-<ano 2 digitos>-<6 letras/numeros>,
-- sorteado e unico. Os documentos antigos ganham um codigo novo aqui.
--
-- Quem assina pode ser empresa: o documento do signatario aceita CPF ou CNPJ.
--
-- Idempotente e restrita a sys_mail_*.

alter table sys_mail_assin_documentos add column if not exists codigo varchar(20);

do $$
declare
  r record;
  novo text;
  -- sem 0/O, 1/I/L: o codigo e lido em voz alta e digitado
  alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
begin
  for r in select id, created_at from sys_mail_assin_documentos where codigo is null loop
    loop
      novo := 'ASS-' || to_char(r.created_at at time zone 'America/Sao_Paulo', 'YY') || '-' ||
        (select string_agg(substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1), '')
           from generate_series(1, 6));
      exit when not exists (select 1 from sys_mail_assin_documentos where codigo = novo);
    end loop;
    update sys_mail_assin_documentos set codigo = novo where id = r.id;
  end loop;
end $$;

create unique index if not exists sys_mail_assin_documentos_codigo_idx on sys_mail_assin_documentos (codigo);

-- CPF (11) ou CNPJ (14)
alter table sys_mail_assin_signatarios alter column cpf type varchar(14);
