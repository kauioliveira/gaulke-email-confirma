-- Solicitacoes: codigo publico aleatorio (SOL-26-X7K2P9), como nas
-- assinaturas (0015). O SOL-000012 saia do id e revelava a sequencia.
--
-- Idempotente e restrita a sys_mail_*.

alter table sys_mail_solic add column if not exists codigo varchar(20);

do $$
declare
  r record;
  novo text;
  alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
begin
  for r in select id, created_at from sys_mail_solic where codigo is null loop
    loop
      novo := 'SOL-' || to_char(r.created_at at time zone 'America/Sao_Paulo', 'YY') || '-' ||
        (select string_agg(substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1), '')
           from generate_series(1, 6));
      exit when not exists (select 1 from sys_mail_solic where codigo = novo);
    end loop;
    update sys_mail_solic set codigo = novo where id = r.id;
  end loop;
end $$;

create unique index if not exists sys_mail_solic_codigo_idx on sys_mail_solic (codigo);
