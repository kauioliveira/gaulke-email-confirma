-- Solicitacao de documentos: a Gaulke pede, o cliente envia por item de um
-- checklist, a Gaulke analisa (aprova/recusa) e guarda tudo na pasta do cliente.
--
-- Idempotente e restrita a sys_mail_*.

-- ---------------------------------------------------------------------------
-- Modelos de checklist (reutilizaveis: "Abertura de empresa", "Admissao"...)
-- ---------------------------------------------------------------------------
create table if not exists sys_mail_checklists (
  id              serial       primary key,
  nome            varchar(160) not null,
  descricao       text,
  setor           varchar(60),
  ativo           boolean      not null default true,
  criado_por_nome varchar(255),
  atualizado_por_nome varchar(255),
  created_at      timestamptz  not null default now(),
  updated_at      timestamptz  not null default now()
);

create table if not exists sys_mail_checklist_itens (
  id            serial       primary key,
  checklist_id  integer      not null references sys_mail_checklists(id) on delete cascade,
  ordem         integer      not null default 0,
  titulo        varchar(200) not null,
  instrucao     text,
  obrigatorio   boolean      not null default true,
  -- familias aceitas ('PDF', 'Imagem', 'Word'...); vazio = qualquer formato aceito
  tipos         text[]       not null default '{}',
  max_arquivos  integer      not null default 5,
  -- arquivo para o cliente baixar, preencher e devolver (ficha, declaracao)
  modelo_path   text,
  modelo_nome   varchar(260)
);
create index if not exists sys_mail_checklist_itens_idx on sys_mail_checklist_itens (checklist_id, ordem);

-- ---------------------------------------------------------------------------
-- Solicitacao: UMA por cliente (um destinatario)
-- ---------------------------------------------------------------------------
create table if not exists sys_mail_solic (
  id                 serial       primary key,
  titulo             varchar(200) not null,
  mensagem           text,
  checklist_id       integer      references sys_mail_checklists(id) on delete set null,
  destinatario_nome  varchar(200),
  destinatario_email varchar(320) not null,
  documento          varchar(20),
  empresa            varchar(200),
  -- link do cliente: /r/<token>
  token              varchar(36)  not null,
  prazo              date,
  -- aberta (esperando o cliente) | em_analise (o cliente entregou o
  -- obrigatorio e ha o que analisar) | concluida | cancelada.
  -- "Atrasada" nao e status: e aberta com o prazo vencido, calculado na tela.
  status             varchar(20)  not null default 'aberta',
  -- solicitacoes criadas juntas (o mesmo pedido para varios clientes)
  grupo              varchar(36),
  conta_id           integer      references sys_mail_accounts(id) on delete set null,
  conta_nome         varchar(120),
  responder_para     varchar(300),
  lembretes          boolean      not null default true,
  lembretes_enviados integer      not null default 0,
  ultimo_lembrete_em timestamptz,
  -- avisa o cliente por e-mail quando a Gaulke concluir
  avisar_conclusao   boolean      not null default true,
  message_id         text,
  envio_erro         text,
  primeiro_acesso_em timestamptz,
  ultimo_acesso_em   timestamptz,
  -- ultimo arquivo ou "nao possuo" do cliente
  ultima_entrega_em  timestamptz,
  -- quem pediu ja foi avisado de que o cliente terminou de entregar
  aviso_equipe_em    timestamptz,
  -- pasta do cliente, relativa ao diretorio de documentos
  pasta              text,
  criado_por_user_id integer,
  criado_por_nome    varchar(255),
  criado_por_email   varchar(320),
  enviado_em         timestamptz,
  concluida_em       timestamptz,
  concluida_por_nome varchar(255),
  cancelada_em       timestamptz,
  cancelada_por_nome varchar(255),
  cancelada_motivo   text,
  created_at         timestamptz  not null default now()
);
create unique index if not exists sys_mail_solic_token_idx on sys_mail_solic (token);
create index if not exists sys_mail_solic_status_idx on sys_mail_solic (status);
create index if not exists sys_mail_solic_email_idx on sys_mail_solic (destinatario_email);
create index if not exists sys_mail_solic_grupo_idx on sys_mail_solic (grupo) where grupo is not null;

create table if not exists sys_mail_solic_itens (
  id                 serial       primary key,
  solic_id           integer      not null references sys_mail_solic(id) on delete cascade,
  ordem              integer      not null default 0,
  titulo             varchar(200) not null,
  instrucao          text,
  obrigatorio        boolean      not null default true,
  tipos              text[]       not null default '{}',
  max_arquivos       integer      not null default 5,
  modelo_path        text,
  modelo_nome        varchar(260),
  -- pendente | enviado | aprovado | recusado | nao_possui
  status             varchar(20)  not null default 'pendente',
  -- motivo da recusa (Gaulke) ou justificativa do "nao possuo" (cliente)
  motivo             text,
  analisado_por_nome varchar(255),
  analisado_em       timestamptz,
  -- a recusa ja foi comunicada ao cliente (o aviso junta varias num e-mail so)
  recusa_avisada_em  timestamptz
);
create index if not exists sys_mail_solic_itens_idx on sys_mail_solic_itens (solic_id, ordem);

create table if not exists sys_mail_solic_arquivos (
  id             bigserial    primary key,
  item_id        integer      not null references sys_mail_solic_itens(id) on delete cascade,
  solic_id       integer      not null references sys_mail_solic(id) on delete cascade,
  -- relativo ao diretorio de documentos; enquanto em quarentena, fica la
  caminho        text         not null,
  nome_original  varchar(260) not null,
  tamanho        integer      not null,
  mime           varchar(120),
  sha256         char(64)     not null,
  -- pendente | limpo | infectado | sem_antivirus | erro
  antivirus      varchar(20)  not null default 'pendente',
  antivirus_msg  text,
  enviado_em     timestamptz  not null default now(),
  ip             varchar(64),
  user_agent     text,
  -- o cliente pode tirar um arquivo antes da analise; o registro fica
  removido_em    timestamptz
);
create index if not exists sys_mail_solic_arquivos_item_idx on sys_mail_solic_arquivos (item_id);
create index if not exists sys_mail_solic_arquivos_av_idx on sys_mail_solic_arquivos (antivirus) where antivirus in ('pendente', 'erro');

-- historico da solicitacao (append-only): quem fez o que e quando
create table if not exists sys_mail_solic_eventos (
  id          bigserial    primary key,
  solic_id    integer      not null references sys_mail_solic(id) on delete cascade,
  item_id     integer,
  tipo        varchar(40)  not null,
  descricao   text         not null,
  por_nome    varchar(255),
  ip          varchar(64),
  meta        jsonb,
  criado_em   timestamptz  not null default now()
);
create index if not exists sys_mail_solic_eventos_idx on sys_mail_solic_eventos (solic_id, criado_em);

-- ---------------------------------------------------------------------------
-- Modelos iniciais (so na primeira vez)
-- ---------------------------------------------------------------------------
do $$
declare cid integer;
begin
  if not exists (select 1 from sys_mail_checklists) then
    insert into sys_mail_checklists (nome, descricao, setor, criado_por_nome)
      values ('Abertura de empresa', 'Documentos para constituir a empresa: sócios, endereço e atividade.', 'Societário', 'modelo inicial')
      returning id into cid;
    insert into sys_mail_checklist_itens (checklist_id, ordem, titulo, instrucao, obrigatorio, tipos, max_arquivos) values
      (cid, 1, 'RG ou CNH de cada sócio', 'Frente e verso, legível. Pode ser foto ou PDF.', true, '{PDF,imagem}', 10),
      (cid, 2, 'Comprovante de endereço de cada sócio', 'Emitido nos últimos 90 dias (água, luz, telefone).', true, '{PDF,imagem}', 10),
      (cid, 3, 'IPTU ou contrato de locação do imóvel da empresa', 'Do endereço onde a empresa vai funcionar.', true, '{PDF,imagem}', 5),
      (cid, 4, 'Certidão de casamento', 'Só para sócio casado.', false, '{PDF,imagem}', 5),
      (cid, 5, 'Descrição das atividades', 'O que a empresa vai fazer, com as suas palavras.', true, '{PDF,Word,Texto}', 3);

    insert into sys_mail_checklists (nome, descricao, setor, criado_por_nome)
      values ('Alteração contratual', 'Mudança de sócios, capital, endereço ou atividade.', 'Societário', 'modelo inicial')
      returning id into cid;
    insert into sys_mail_checklist_itens (checklist_id, ordem, titulo, instrucao, obrigatorio, tipos, max_arquivos) values
      (cid, 1, 'Documento pessoal dos novos sócios', 'RG ou CNH, frente e verso.', false, '{PDF,imagem}', 10),
      (cid, 2, 'Comprovante do novo endereço', 'Se o endereço mudar: IPTU ou contrato de locação.', false, '{PDF,imagem}', 5),
      (cid, 3, 'Descrição da alteração', 'O que muda, e a partir de quando.', true, '{PDF,Word,Texto}', 3);

    insert into sys_mail_checklists (nome, descricao, setor, criado_por_nome)
      values ('Admissão de funcionário', 'Documentos para registrar um novo funcionário.', 'DP', 'modelo inicial')
      returning id into cid;
    insert into sys_mail_checklist_itens (checklist_id, ordem, titulo, instrucao, obrigatorio, tipos, max_arquivos) values
      (cid, 1, 'RG e CPF', 'Frente e verso, legível.', true, '{PDF,imagem}', 4),
      (cid, 2, 'Carteira de trabalho (digital)', 'Print ou PDF da CTPS digital.', true, '{PDF,imagem}', 3),
      (cid, 3, 'Comprovante de endereço', 'Últimos 90 dias.', true, '{PDF,imagem}', 2),
      (cid, 4, 'Exame admissional (ASO)', null, true, '{PDF,imagem}', 2),
      (cid, 5, 'Certidão de nascimento dos filhos menores de 14 anos', 'Para salário-família.', false, '{PDF,imagem}', 6);

    insert into sys_mail_checklists (nome, descricao, setor, criado_por_nome)
      values ('Imposto de Renda (IRPF)', 'Informes e comprovantes para a declaração anual.', 'Fiscal', 'modelo inicial')
      returning id into cid;
    insert into sys_mail_checklist_itens (checklist_id, ordem, titulo, instrucao, obrigatorio, tipos, max_arquivos) values
      (cid, 1, 'Informes de rendimentos', 'Do empregador, bancos, corretoras e aposentadoria.', true, '{PDF,imagem}', 20),
      (cid, 2, 'Comprovantes de despesas médicas', 'Recibos e notas com CPF/CNPJ do prestador.', false, '{PDF,imagem}', 30),
      (cid, 3, 'Comprovantes de educação', 'Mensalidades escolares e faculdade.', false, '{PDF,imagem}', 20),
      (cid, 4, 'Declaração do ano anterior', 'O recibo e a declaração completa.', false, '{PDF}', 2);
  end if;
end $$;
