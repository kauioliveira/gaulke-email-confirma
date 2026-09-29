-- Assinatura digital (Fase 7): certificado A1 da Gaulke, documentos para
-- assinar, signatarios, campos posicionados no PDF e historico encadeado.
--
-- Idempotente e restrita a sys_mail_*.

-- ---------------------------------------------------------------------------
-- Certificados A1 (e-CNPJ da Gaulke)
--
-- Mesmo desenho do cofre do painel: o .pfx e convertido no upload, a chave
-- privada fica CIFRADA (AES-256-GCM, SMTP_CRYPTO_KEY) e a SENHA E DESCARTADA.
-- O certificado (parte publica) fica em claro.
-- ---------------------------------------------------------------------------
create table if not exists sys_mail_certificados (
  id                  serial       primary key,
  nome                varchar(120) not null,
  titular             varchar(255) not null,
  -- CNPJ/CPF lido do certificado (OID ICP-Brasil); pode faltar em A1 fora do padrao
  documento           varchar(14),
  documento_tipo      varchar(4),
  -- responsavel pelo e-CNPJ (OID 2.16.76.1.3.2 / .3.4), quando presente
  responsavel         varchar(255),
  emissor             varchar(255),
  serial              varchar(64),
  fingerprint_sha256  char(64)     not null,
  valido_de           timestamptz  not null,
  valido_ate          timestamptz  not null,
  -- a cadeia chega ate uma AC ICP-Brasil?
  icp_brasil          boolean      not null default false,
  -- titular primeiro, depois os intermediarios, em PEM
  cert_pem            text         not null,
  chave_cifrada       text         not null,
  nome_arquivo        varchar(255),
  padrao              boolean      not null default false,
  ultimo_teste_em     timestamptz,
  ultimo_teste_ok     boolean,
  ultimo_teste_msg    text,
  -- ultimo aviso de vencimento enviado (30, 15, 7 ou 0 = vencido)
  alerta_dias         integer,
  criado_por_nome     varchar(255),
  criado_em           timestamptz  not null default now(),
  revogado_em         timestamptz,
  revogado_por_nome   varchar(255)
);
create unique index if not exists sys_mail_certificados_fp_idx
  on sys_mail_certificados (fingerprint_sha256) where revogado_em is null;

-- ---------------------------------------------------------------------------
-- Documento para assinar
-- ---------------------------------------------------------------------------
create table if not exists sys_mail_assin_documentos (
  id                   serial       primary key,
  titulo               varchar(200) not null,
  mensagem             text,
  -- rascunho | aguardando | concluido | recusado | cancelado
  status               varchar(20)  not null default 'rascunho',
  -- paralela (todos de uma vez) | sequencial (um depois do outro, na ordem)
  ordem                varchar(12)  not null default 'paralela',
  -- selo PAdES com o certificado da Gaulke no PDF final (decisao D6)
  assinar_como_gaulke  boolean      not null default false,
  certificado_id       integer      references sys_mail_certificados(id) on delete set null,
  prazo                date,
  -- cliente/empresa a que o documento se refere: organiza a pasta
  cliente_nome         varchar(200),
  cliente_documento    varchar(14),
  -- caminhos relativos ao diretorio de documentos
  pasta                text,
  original_path        text,
  original_nome        varchar(260),
  original_sha256      char(64),
  original_paginas     integer,
  final_path           text,
  final_sha256         char(64),
  -- codigo curto para a pagina publica /validar
  codigo_verificacao   varchar(16)  not null,
  conta_id             integer      references sys_mail_accounts(id) on delete set null,
  conta_nome           varchar(120),
  responder_para       varchar(300),
  criado_por_user_id   integer,
  criado_por_nome      varchar(255),
  criado_por_email     varchar(320),
  enviado_em           timestamptz,
  concluido_em         timestamptz,
  finalizacao_erro     text,
  cancelado_em         timestamptz,
  cancelado_por_nome   varchar(255),
  cancelado_motivo     text,
  created_at           timestamptz  not null default now()
);
create unique index if not exists sys_mail_assin_documentos_codigo_idx on sys_mail_assin_documentos (codigo_verificacao);
create index if not exists sys_mail_assin_documentos_status_idx on sys_mail_assin_documentos (status);
create index if not exists sys_mail_assin_documentos_final_idx on sys_mail_assin_documentos (final_sha256);
create index if not exists sys_mail_assin_documentos_original_idx on sys_mail_assin_documentos (original_sha256);

create table if not exists sys_mail_assin_signatarios (
  id                 serial       primary key,
  documento_id       integer      not null references sys_mail_assin_documentos(id) on delete cascade,
  ordem              integer      not null default 1,
  nome               varchar(200) not null,
  email              varchar(320) not null,
  cpf                varchar(11),
  -- como aparece na folha: "Contratante", "Testemunha"...
  papel              varchar(60),
  token              varchar(36)  not null,
  -- pendente (ainda nao e a vez) | aguardando | assinado | recusado
  status             varchar(20)  not null default 'pendente',
  convite_enviado_em timestamptz,
  envio_erro         text,
  visualizado_em     timestamptz,
  -- codigo de 6 digitos por e-mail: guardado so o hash
  otp_hash           char(64),
  otp_expira_em      timestamptz,
  otp_tentativas     integer      not null default 0,
  otp_enviado_em     timestamptz,
  otp_validado_em    timestamptz,
  -- digitada (fonte manuscrita fixa) | desenhada
  tipo_assinatura    varchar(12),
  nome_assinatura    varchar(200),
  imagem_assinatura  text,
  assinado_em        timestamptz,
  recusado_em        timestamptz,
  recusa_motivo      text,
  ip                 varchar(64),
  user_agent         text,
  lembretes_enviados integer      not null default 0,
  ultimo_lembrete_em timestamptz
);
create unique index if not exists sys_mail_assin_signatarios_token_idx on sys_mail_assin_signatarios (token);
create index if not exists sys_mail_assin_signatarios_doc_idx on sys_mail_assin_signatarios (documento_id, ordem);

-- campo no PDF, em pontos do PDF (origem no canto INFERIOR esquerdo da pagina)
create table if not exists sys_mail_assin_campos (
  id             serial       primary key,
  documento_id   integer      not null references sys_mail_assin_documentos(id) on delete cascade,
  signatario_id  integer      not null references sys_mail_assin_signatarios(id) on delete cascade,
  -- assinatura | rubrica | data | nome
  tipo           varchar(12)  not null default 'assinatura',
  pagina         integer      not null,
  x              real         not null,
  y              real         not null,
  largura        real         not null,
  altura         real         not null
);
create index if not exists sys_mail_assin_campos_doc_idx on sys_mail_assin_campos (documento_id);

-- historico append-only com hash encadeado: cada linha carrega o hash da
-- anterior; apagar ou alterar uma linha quebra a corrente e a quebra aparece
create table if not exists sys_mail_assin_eventos (
  id              bigserial    primary key,
  documento_id    integer      not null references sys_mail_assin_documentos(id) on delete cascade,
  signatario_id   integer,
  tipo            varchar(40)  not null,
  descricao       text         not null,
  por_nome        varchar(255),
  ip              varchar(64),
  user_agent      text,
  criado_em       timestamptz  not null default now(),
  hash_anterior   char(64),
  hash            char(64)     not null
);
create index if not exists sys_mail_assin_eventos_doc_idx on sys_mail_assin_eventos (documento_id, id);
