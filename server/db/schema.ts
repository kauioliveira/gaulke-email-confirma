import { sql } from 'drizzle-orm'
import {
  pgTable,
  serial,
  bigserial,
  bigint,
  uuid,
  integer,
  varchar,
  text,
  timestamp,
  jsonb,
  boolean,
  char,
  date,
  real,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core'

/**
 * Todas as tabelas deste sistema usam o prefixo `sys_mail_` para nao se
 * misturarem com as demais tabelas do banco da empresa.
 */

/**
 * Contas de envio (SMTP).
 *
 * O host costuma ser o mesmo para todo mundo, mas usuario e senha mudam por
 * setor — por isso a conta guarda o conjunto inteiro em vez de so as
 * credenciais. A senha fica CIFRADA (server/utils/cripto.ts): o SMTP precisa
 * dela em claro para autenticar, entao hash nao serve.
 *
 * Os booleanos sao varchar('true'|'false') para seguir o resto do schema.
 */
export const accounts = pgTable(
  'sys_mail_accounts',
  {
    id: serial('id').primaryKey(),
    /** rotulo humano: "Notifica", "Financeiro" */
    nome: varchar('nome', { length: 120 }).notNull(),
    host: varchar('host', { length: 200 }).notNull(),
    port: integer('port').default(587).notNull(),
    secure: varchar('secure', { length: 5 }).default('false').notNull(),
    requireTls: varchar('require_tls', { length: 5 }).default('true').notNull(),
    rejectUnauthorized: varchar('reject_unauthorized', { length: 5 }).default('true').notNull(),
    usuario: varchar('usuario', { length: 200 }).notNull(),
    /** v1:<iv>:<tag>:<cifrado>, base64url — NUNCA sai numa resposta da API */
    senhaCifrada: text('senha_cifrada').notNull(),
    /** cabecalho From, no formato Nome <email@dominio> */
    remetente: varchar('remetente', { length: 300 }).notNull(),
    responderPara: varchar('responder_para', { length: 300 }),
    ativa: varchar('ativa', { length: 5 }).default('true').notNull(),
    padrao: varchar('padrao', { length: 5 }).default('false').notNull(),
    // ultimo teste de conexao: a tela precisa poder dizer que a conta parou de
    // funcionar depois de salva, e nao so no momento em que foi cadastrada
    ultimoTesteEm: timestamp('ultimo_teste_em', { withTimezone: true }),
    ultimoTesteOk: varchar('ultimo_teste_ok', { length: 5 }),
    ultimoTesteMsg: text('ultimo_teste_msg'),
    criadoPorNome: varchar('criado_por_nome', { length: 255 }),
    atualizadoPorNome: varchar('atualizado_por_nome', { length: 255 }),
    // monitor da caixa (IMAP): SO LE, nunca move, apaga ou marca como lida
    monitorarCaixa: boolean('monitorar_caixa').default(false).notNull(),
    // nulo = o mesmo host do SMTP
    imapHost: varchar('imap_host', { length: 200 }),
    imapPort: integer('imap_port').default(993).notNull(),
    imapSecure: boolean('imap_secure').default(true).notNull(),
    criarTickets: boolean('criar_tickets').default(false).notNull(),
    diasSemConfirmacao: integer('dias_sem_confirmacao').default(3).notNull(),
    imapUidvalidity: bigint('imap_uidvalidity', { mode: 'number' }),
    imapUltimoUid: bigint('imap_ultimo_uid', { mode: 'number' }),
    imapUltimaLeituraEm: timestamp('imap_ultima_leitura_em', { withTimezone: true }),
    imapUltimoErro: text('imap_ultimo_erro'),
    imapUltimoErroEm: timestamp('imap_ultimo_erro_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  t => [
    uniqueIndex('sys_mail_accounts_nome_idx').on(sql`lower(${t.nome})`),
    // so uma padrao por vez, garantido pelo banco
    uniqueIndex('sys_mail_accounts_padrao_idx')
      .on(t.padrao)
      .where(sql`${t.padrao} = 'true'`)
  ]
)

export const templates = pgTable('sys_mail_templates', {
  id: serial('id').primaryKey(),
  nome: varchar('nome', { length: 160 }).notNull(),
  assunto: varchar('assunto', { length: 300 }).notNull(),
  // html e sempre a fonte para o ENVIO; em modo 'blocos' ele e GERADO a
  // partir de `blocos` ao salvar, e nunca editado a mao
  html: text('html').notNull(),
  formato: varchar('formato', { length: 10 }).default('html').notNull(),
  blocos: jsonb('blocos'),
  // autoria como snapshot, pelo mesmo motivo dos lotes (veja batches)
  criadoPorUserId: integer('criado_por_user_id'),
  criadoPorNome: varchar('criado_por_nome', { length: 255 }),
  atualizadoPorUserId: integer('atualizado_por_user_id'),
  atualizadoPorNome: varchar('atualizado_por_nome', { length: 255 }),
  // documento | comunicado — escolhido na primeira fase do assistente (Fase 2)
  tipo: varchar('tipo', { length: 20 }),
  categoria: varchar('categoria', { length: 60 }),
  // oficial: so supervisor/admin editam; os demais duplicam
  oficial: boolean('oficial').default(false).notNull(),
  arquivadoEm: timestamp('arquivado_em', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
})

export const batches = pgTable(
  'sys_mail_batches',
  {
    id: serial('id').primaryKey(),
    nome: varchar('nome', { length: 200 }).notNull(),
    templateId: integer('template_id').references(() => templates.id, { onDelete: 'set null' }),
    // Snapshot do que foi realmente enviado (o template pode mudar depois)
    assuntoSnapshot: varchar('assunto_snapshot', { length: 300 }).notNull(),
    htmlSnapshot: text('html_snapshot').notNull(),
    // snapshot do editor visual, para reabrir um lote ja disparado
    formato: varchar('formato', { length: 10 }).default('html').notNull(),
    blocos: jsonb('blocos'),
    arquivoPath: text('arquivo_path'),
    arquivoNome: varchar('arquivo_nome', { length: 260 }),
    intervaloMs: integer('intervalo_ms').default(10000).notNull(),
    // exigir confirmacao de leitura antes de liberar o download
    exigirConfirmacao: varchar('exigir_confirmacao', { length: 5 }).default('true').notNull(),
    // pede recibo de leitura ao proprio cliente de e-mail (opcional)
    pedirRecibo: varchar('pedir_recibo', { length: 5 }).default('false').notNull(),
    // rascunho | enviando | pausado | concluido | erro
    status: varchar('status', { length: 20 }).default('rascunho').notNull(),
    total: integer('total').default(0).notNull(),
    enviados: integer('enviados').default(0).notNull(),
    falhas: integer('falhas').default(0).notNull(),
    // Autoria: snapshot com nome, sem FK para public.users (tabela de outro
    // sistema). O nome fica gravado para o relatorio continuar identificando
    // quem disparou mesmo depois de a pessoa sair da empresa.
    criadoPorUserId: integer('criado_por_user_id'),
    criadoPorNome: varchar('criado_por_nome', { length: 255 }),
    disparadoPorUserId: integer('disparado_por_user_id'),
    disparadoPorNome: varchar('disparado_por_nome', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    // disparo agendado
    agendadoPara: timestamp('agendado_para', { withTimezone: true }),
    agendadoEm: timestamp('agendado_em', { withTimezone: true }),
    // motivo quando o proprio sistema muda o status (ex.: agendamento vencido)
    observacao: text('observacao'),
    // Conta de envio usada no disparo. O nome vai junto para o relatorio
    // continuar dizendo de onde o e-mail saiu mesmo se a conta for excluida.
    contaId: integer('conta_id').references(() => accounts.id, { onDelete: 'set null' }),
    contaNome: varchar('conta_nome', { length: 120 }),
    // "Respostas para" escolhido no envio; nulo = o reply-to do proprio canal
    responderPara: varchar('responder_para', { length: 300 }),
    // arquivar: so organizacao da lista, o destinatario nao percebe nada
    arquivadoEm: timestamp('arquivado_em', { withTimezone: true }),
    arquivadoPorNome: varchar('arquivado_por_nome', { length: 255 }),
    // exclusao LOGICA (lixeira): some das telas, links param, a prova fica
    excluidoEm: timestamp('excluido_em', { withTimezone: true }),
    excluidoPorNome: varchar('excluido_por_nome', { length: 255 }),
    excluidoMotivo: text('excluido_motivo'),
    // abrir ticket no painel para respostas e falta de confirmacao (Fase 3)
    criarTickets: boolean('criar_tickets').default(false).notNull(),
    // nenhum (comunicado) | unico (um arquivo para todos) | individual
    modoAnexo: varchar('modo_anexo', { length: 15 }).default('nenhum').notNull(),
    // lembrete automatico a quem nao confirmou: a cada N dias, ate `lembreteMax` vezes
    lembreteDias: integer('lembrete_dias'),
    lembreteMax: integer('lembrete_max').default(0).notNull()
  },
  t => [
    index('sys_mail_batches_status_idx').on(t.status),
    index('sys_mail_batches_agendado_idx').on(t.agendadoPara)
  ]
)

export const recipients = pgTable(
  'sys_mail_recipients',
  {
    id: serial('id').primaryKey(),
    batchId: integer('batch_id')
      .references(() => batches.id, { onDelete: 'cascade' })
      .notNull(),
    nome: varchar('nome', { length: 200 }),
    email: varchar('email', { length: 320 }).notNull(),
    empresa: varchar('empresa', { length: 200 }),
    dadosExtras: jsonb('dados_extras'),
    // link unico e nao adivinhavel
    token: varchar('token', { length: 36 }).notNull(),
    // codigo legivel/citavel por telefone, ex: GLK-7F3K-2M9Q
    codigo: varchar('codigo', { length: 20 }).notNull(),
    // pendente | enviando | enviado | erro | bounce
    status: varchar('status', { length: 20 }).default('pendente').notNull(),
    tentativas: integer('tentativas').default(0).notNull(),
    ultimoErro: text('ultimo_erro'),
    messageId: text('message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    // desnormalizacao dos marcos, para o relatorio ficar rapido
    firstOpenAt: timestamp('first_open_at', { withTimezone: true }),
    // todas as aberturas, nao so a primeira
    openCount: integer('open_count').default(0).notNull(),
    lastOpenAt: timestamp('last_open_at', { withTimezone: true }),
    // primeira abertura que NAO parece pre-carregamento de maquina
    firstHumanOpenAt: timestamp('first_human_open_at', { withTimezone: true }),
    firstAccessAt: timestamp('first_access_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    firstDownloadAt: timestamp('first_download_at', { withTimezone: true }),
    downloadCount: integer('download_count').default(0).notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    // reenvio pedido pela fila do lote: motivo e quem pediu, ate o worker enviar
    reenvioPendente: jsonb('reenvio_pendente').$type<ReenvioPendente | null>(),
    // CPF/CNPJ (so digitos) e o arquivo individual desta pessoa (Fase 4)
    documento: varchar('documento', { length: 20 }),
    arquivoPath: text('arquivo_path'),
    arquivoNome: varchar('arquivo_nome', { length: 260 }),
    // o que voltou pela caixa do canal (monitor IMAP)
    bounceAt: timestamp('bounce_at', { withTimezone: true }),
    bounceTipo: varchar('bounce_tipo', { length: 20 }),
    bounceMotivo: text('bounce_motivo'),
    respondeuAt: timestamp('respondeu_at', { withTimezone: true }),
    respostaCount: integer('resposta_count').default(0).notNull(),
    reciboAt: timestamp('recibo_at', { withTimezone: true }),
    lembretesEnviados: integer('lembretes_enviados').default(0).notNull(),
    ultimoLembreteEm: timestamp('ultimo_lembrete_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  t => [
    uniqueIndex('sys_mail_recipients_token_idx').on(t.token),
    uniqueIndex('sys_mail_recipients_codigo_idx').on(t.codigo),
    index('sys_mail_recipients_batch_idx').on(t.batchId),
    index('sys_mail_recipients_batch_status_idx').on(t.batchId, t.status),
    index('sys_mail_recipients_email_idx').on(t.email)
  ]
)

export const events = pgTable(
  'sys_mail_events',
  {
    id: serial('id').primaryKey(),
    recipientId: integer('recipient_id')
      .references(() => recipients.id, { onDelete: 'cascade' })
      .notNull(),
    // enfileirado | enviado | erro | abertura | acesso | confirmacao | download | reenvio
    tipo: varchar('tipo', { length: 20 }).notNull(),
    ip: varchar('ip', { length: 64 }),
    userAgent: text('user_agent'),
    referer: text('referer'),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  t => [
    index('sys_mail_events_recipient_idx').on(t.recipientId),
    index('sys_mail_events_created_idx').on(t.createdAt),
    index('sys_mail_events_tipo_idx').on(t.tipo)
  ]
)

/**
 * Historico de versoes de um template: cada salvamento guarda uma copia
 * completa, para desfazer uma edicao ruim. Os lotes nao dependem disto — eles
 * guardam o proprio snapshot do que foi enviado.
 */
export const templateVersoes = pgTable(
  'sys_mail_template_versoes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    templateId: integer('template_id')
      .references(() => templates.id, { onDelete: 'cascade' })
      .notNull(),
    versao: integer('versao').notNull(),
    nome: varchar('nome', { length: 160 }).notNull(),
    assunto: varchar('assunto', { length: 300 }).notNull(),
    formato: varchar('formato', { length: 10 }).notNull(),
    blocos: jsonb('blocos'),
    html: text('html').notNull(),
    tipo: varchar('tipo', { length: 20 }),
    categoria: varchar('categoria', { length: 60 }),
    salvoPorUserId: integer('salvo_por_user_id'),
    salvoPorNome: varchar('salvo_por_nome', { length: 255 }),
    salvoEm: timestamp('salvo_em', { withTimezone: true }).defaultNow().notNull()
  },
  t => [uniqueIndex('sys_mail_template_versoes_idx').on(t.templateId, t.versao)]
)

/**
 * Cada e-mail que saiu para um destinatario: o envio original do lote (no 1)
 * e cada reenvio (2, 3...). O destinatario so guarda o ULTIMO; aqui fica a
 * historia inteira — quem reenviou, para qual endereco, por qual canal e por
 * que — e o message_id de cada um, que liga a resposta do cliente ao envio.
 */
export const envios = pgTable(
  'sys_mail_envios',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    recipientId: integer('recipient_id')
      .references(() => recipients.id, { onDelete: 'cascade' })
      .notNull(),
    numero: integer('numero').notNull(),
    // lote | reenvio
    origem: varchar('origem', { length: 20 }).default('lote').notNull(),
    para: varchar('para', { length: 320 }).notNull(),
    messageId: text('message_id'),
    contaId: integer('conta_id'),
    contaNome: varchar('conta_nome', { length: 120 }),
    responderPara: varchar('responder_para', { length: 300 }),
    // enviado | erro
    status: varchar('status', { length: 20 }).notNull(),
    erro: text('erro'),
    // o que o servidor SMTP respondeu (ex.: "250 2.0.0 Ok: queued as 4F2A1")
    respostaSmtp: text('resposta_smtp'),
    motivo: text('motivo'),
    enviadoPorUserId: integer('enviado_por_user_id'),
    enviadoPorNome: varchar('enviado_por_nome', { length: 255 }),
    enviadoEm: timestamp('enviado_em', { withTimezone: true }).defaultNow().notNull()
  },
  t => [
    uniqueIndex('sys_mail_envios_numero_idx').on(t.recipientId, t.numero),
    index('sys_mail_envios_message_idx').on(t.messageId)
  ]
)

/**
 * Trilha de auditoria: toda acao que altera algo, de qualquer usuario.
 *
 * Append-only, como sys_mail_events. O nome vai como snapshot (sem FK para
 * public.users) para a trilha sobreviver a saida da pessoa da empresa.
 */
export const auditoria = pgTable(
  'sys_mail_auditoria',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    quando: timestamp('quando', { withTimezone: true }).defaultNow().notNull(),
    userId: integer('user_id'),
    userNome: varchar('user_nome', { length: 255 }),
    // admin | supervisor | usuario, no momento da acao
    papel: varchar('papel', { length: 20 }),
    // entidade.acao: lote.excluir, template.editar, conta.criar
    acao: varchar('acao', { length: 60 }).notNull(),
    entidade: varchar('entidade', { length: 40 }),
    entidadeId: varchar('entidade_id', { length: 64 }),
    resumo: text('resumo').notNull(),
    // antes/depois dos campos alterados; NUNCA senhas
    dados: jsonb('dados'),
    ip: varchar('ip', { length: 64 }),
    userAgent: text('user_agent')
  },
  t => [
    index('sys_mail_auditoria_quando_idx').on(t.quando),
    index('sys_mail_auditoria_entidade_idx').on(t.entidade, t.entidadeId),
    index('sys_mail_auditoria_user_idx').on(t.userId),
    index('sys_mail_auditoria_acao_idx').on(t.acao)
  ]
)

/** Configuracoes que o admin muda pela tela, sem deploy. */
export const config = pgTable('sys_mail_config', {
  chave: varchar('chave', { length: 80 }).primaryKey(),
  valor: jsonb('valor').notNull(),
  atualizadoPorNome: varchar('atualizado_por_nome', { length: 255 }),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).defaultNow().notNull()
})

/** Mensagens lidas da caixa de cada canal (so metadados quando sem vinculo). */
export const inbound = pgTable(
  'sys_mail_inbound',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    contaId: integer('conta_id').references(() => accounts.id, { onDelete: 'set null' }),
    contaNome: varchar('conta_nome', { length: 120 }),
    uidvalidity: bigint('uidvalidity', { mode: 'number' }).notNull(),
    uid: bigint('uid', { mode: 'number' }).notNull(),
    messageId: text('message_id'),
    de: text('de'),
    assunto: text('assunto'),
    recebidoEm: timestamp('recebido_em', { withTimezone: true }),
    classificacao: varchar('classificacao', { length: 30 }).notNull(),
    recipientId: integer('recipient_id').references(() => recipients.id, { onDelete: 'set null' }),
    batchId: integer('batch_id').references(() => batches.id, { onDelete: 'set null' }),
    vinculo: varchar('vinculo', { length: 30 }),
    trecho: text('trecho'),
    detalhe: jsonb('detalhe'),
    // resposta/devolucao de um e-mail de solicitacao ou de assinatura (Fase 8)
    solicId: integer('solic_id'),
    assinDocumentoId: integer('assin_documento_id'),
    assinSignatarioId: integer('assin_signatario_id'),
    processadoEm: timestamp('processado_em', { withTimezone: true }).defaultNow().notNull()
  },
  t => [
    uniqueIndex('sys_mail_inbound_uid_idx').on(t.contaId, t.uidvalidity, t.uid),
    index('sys_mail_inbound_recipient_idx').on(t.recipientId)
  ]
)

/** Fila de chamados no painel: tentada de novo ate o painel responder. */
export const ticketsPainel = pgTable('sys_mail_tickets', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  motivo: varchar('motivo', { length: 30 }).notNull(),
  batchId: integer('batch_id').references(() => batches.id, { onDelete: 'cascade' }),
  recipientId: integer('recipient_id').references(() => recipients.id, { onDelete: 'cascade' }),
  inboundId: bigint('inbound_id', { mode: 'number' }).references(() => inbound.id, { onDelete: 'set null' }),
  solicitanteUserId: integer('solicitante_user_id'),
  titulo: varchar('titulo', { length: 255 }).notNull(),
  descricao: text('descricao').notNull(),
  externalCode: varchar('external_code', { length: 120 }).notNull(),
  externalUrl: text('external_url'),
  ticketUuid: uuid('ticket_uuid'),
  ticketCode: varchar('ticket_code', { length: 40 }),
  acao: varchar('acao', { length: 20 }),
  statusEnvio: varchar('status_envio', { length: 20 }).default('pendente').notNull(),
  tentativas: integer('tentativas').default(0).notNull(),
  erro: text('erro'),
  proximaTentativaEm: timestamp('proxima_tentativa_em', { withTimezone: true }).defaultNow().notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).defaultNow().notNull()
})

/** Enderecos que devolveram definitivamente: nao recebem mais envios. */
export const supressao = pgTable('sys_mail_supressao', {
  email: varchar('email', { length: 320 }).primaryKey(),
  motivo: text('motivo'),
  origem: varchar('origem', { length: 30 }).notNull(),
  recipientId: integer('recipient_id').references(() => recipients.id, { onDelete: 'set null' }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
  criadoPorNome: varchar('criado_por_nome', { length: 255 })
})

/* -------------------------------------------------------------------------
 * Solicitacao de documentos
 * ---------------------------------------------------------------------- */

/** Modelo de checklist reutilizavel ("Abertura de empresa", "IRPF"...). */
export const checklists = pgTable('sys_mail_checklists', {
  id: serial('id').primaryKey(),
  nome: varchar('nome', { length: 160 }).notNull(),
  descricao: text('descricao'),
  setor: varchar('setor', { length: 60 }),
  ativo: boolean('ativo').default(true).notNull(),
  criadoPorNome: varchar('criado_por_nome', { length: 255 }),
  atualizadoPorNome: varchar('atualizado_por_nome', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
})

export const checklistItens = pgTable('sys_mail_checklist_itens', {
  id: serial('id').primaryKey(),
  checklistId: integer('checklist_id')
    .notNull()
    .references(() => checklists.id, { onDelete: 'cascade' }),
  ordem: integer('ordem').default(0).notNull(),
  titulo: varchar('titulo', { length: 200 }).notNull(),
  instrucao: text('instrucao'),
  obrigatorio: boolean('obrigatorio').default(true).notNull(),
  tipos: text('tipos').array().default(sql`'{}'`).notNull(),
  maxArquivos: integer('max_arquivos').default(5).notNull(),
  modeloPath: text('modelo_path'),
  modeloNome: varchar('modelo_nome', { length: 260 })
})

/** Uma solicitacao = um cliente. O pedido para varios clientes vira varias, com o mesmo grupo. */
export const solicitacoes = pgTable('sys_mail_solic', {
  id: serial('id').primaryKey(),
  titulo: varchar('titulo', { length: 200 }).notNull(),
  mensagem: text('mensagem'),
  checklistId: integer('checklist_id').references(() => checklists.id, { onDelete: 'set null' }),
  destinatarioNome: varchar('destinatario_nome', { length: 200 }),
  destinatarioEmail: varchar('destinatario_email', { length: 320 }).notNull(),
  documento: varchar('documento', { length: 20 }),
  empresa: varchar('empresa', { length: 200 }),
  token: varchar('token', { length: 36 }).notNull(),
  prazo: date('prazo'),
  status: varchar('status', { length: 20 }).default('aberta').notNull(),
  grupo: varchar('grupo', { length: 36 }),
  contaId: integer('conta_id').references(() => accounts.id, { onDelete: 'set null' }),
  contaNome: varchar('conta_nome', { length: 120 }),
  responderPara: varchar('responder_para', { length: 300 }),
  lembretes: boolean('lembretes').default(true).notNull(),
  lembretesEnviados: integer('lembretes_enviados').default(0).notNull(),
  ultimoLembreteEm: timestamp('ultimo_lembrete_em', { withTimezone: true }),
  avisarConclusao: boolean('avisar_conclusao').default(true).notNull(),
  messageId: text('message_id'),
  envioErro: text('envio_erro'),
  primeiroAcessoEm: timestamp('primeiro_acesso_em', { withTimezone: true }),
  ultimoAcessoEm: timestamp('ultimo_acesso_em', { withTimezone: true }),
  ultimaEntregaEm: timestamp('ultima_entrega_em', { withTimezone: true }),
  avisoEquipeEm: timestamp('aviso_equipe_em', { withTimezone: true }),
  pasta: text('pasta'),
  criadoPorUserId: integer('criado_por_user_id'),
  criadoPorNome: varchar('criado_por_nome', { length: 255 }),
  criadoPorEmail: varchar('criado_por_email', { length: 320 }),
  enviadoEm: timestamp('enviado_em', { withTimezone: true }),
  concluidaEm: timestamp('concluida_em', { withTimezone: true }),
  concluidaPorNome: varchar('concluida_por_nome', { length: 255 }),
  canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
  canceladaPorNome: varchar('cancelada_por_nome', { length: 255 }),
  canceladaMotivo: text('cancelada_motivo'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
})

export const solicItens = pgTable('sys_mail_solic_itens', {
  id: serial('id').primaryKey(),
  solicId: integer('solic_id')
    .notNull()
    .references(() => solicitacoes.id, { onDelete: 'cascade' }),
  ordem: integer('ordem').default(0).notNull(),
  titulo: varchar('titulo', { length: 200 }).notNull(),
  instrucao: text('instrucao'),
  obrigatorio: boolean('obrigatorio').default(true).notNull(),
  tipos: text('tipos').array().default(sql`'{}'`).notNull(),
  maxArquivos: integer('max_arquivos').default(5).notNull(),
  modeloPath: text('modelo_path'),
  modeloNome: varchar('modelo_nome', { length: 260 }),
  status: varchar('status', { length: 20 }).default('pendente').notNull(),
  motivo: text('motivo'),
  analisadoPorNome: varchar('analisado_por_nome', { length: 255 }),
  analisadoEm: timestamp('analisado_em', { withTimezone: true }),
  recusaAvisadaEm: timestamp('recusa_avisada_em', { withTimezone: true })
})

export const solicArquivos = pgTable('sys_mail_solic_arquivos', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  itemId: integer('item_id')
    .notNull()
    .references(() => solicItens.id, { onDelete: 'cascade' }),
  solicId: integer('solic_id')
    .notNull()
    .references(() => solicitacoes.id, { onDelete: 'cascade' }),
  caminho: text('caminho').notNull(),
  nomeOriginal: varchar('nome_original', { length: 260 }).notNull(),
  tamanho: integer('tamanho').notNull(),
  mime: varchar('mime', { length: 120 }),
  sha256: char('sha256', { length: 64 }).notNull(),
  antivirus: varchar('antivirus', { length: 20 }).default('pendente').notNull(),
  antivirusMsg: text('antivirus_msg'),
  enviadoEm: timestamp('enviado_em', { withTimezone: true }).defaultNow().notNull(),
  ip: varchar('ip', { length: 64 }),
  userAgent: text('user_agent'),
  removidoEm: timestamp('removido_em', { withTimezone: true })
})

export const solicEventos = pgTable('sys_mail_solic_eventos', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  solicId: integer('solic_id')
    .notNull()
    .references(() => solicitacoes.id, { onDelete: 'cascade' }),
  itemId: integer('item_id'),
  tipo: varchar('tipo', { length: 40 }).notNull(),
  descricao: text('descricao').notNull(),
  porNome: varchar('por_nome', { length: 255 }),
  ip: varchar('ip', { length: 64 }),
  meta: jsonb('meta'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull()
})

/* -------------------------------------------------------------------------
 * Assinatura digital
 * ---------------------------------------------------------------------- */

export const certificados = pgTable('sys_mail_certificados', {
  id: serial('id').primaryKey(),
  nome: varchar('nome', { length: 120 }).notNull(),
  titular: varchar('titular', { length: 255 }).notNull(),
  documento: varchar('documento', { length: 14 }),
  documentoTipo: varchar('documento_tipo', { length: 4 }),
  responsavel: varchar('responsavel', { length: 255 }),
  emissor: varchar('emissor', { length: 255 }),
  serial: varchar('serial', { length: 64 }),
  fingerprintSha256: char('fingerprint_sha256', { length: 64 }).notNull(),
  validoDe: timestamp('valido_de', { withTimezone: true }).notNull(),
  validoAte: timestamp('valido_ate', { withTimezone: true }).notNull(),
  icpBrasil: boolean('icp_brasil').default(false).notNull(),
  certPem: text('cert_pem').notNull(),
  chaveCifrada: text('chave_cifrada').notNull(),
  nomeArquivo: varchar('nome_arquivo', { length: 255 }),
  padrao: boolean('padrao').default(false).notNull(),
  ultimoTesteEm: timestamp('ultimo_teste_em', { withTimezone: true }),
  ultimoTesteOk: boolean('ultimo_teste_ok'),
  ultimoTesteMsg: text('ultimo_teste_msg'),
  alertaDias: integer('alerta_dias'),
  criadoPorNome: varchar('criado_por_nome', { length: 255 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
  revogadoEm: timestamp('revogado_em', { withTimezone: true }),
  revogadoPorNome: varchar('revogado_por_nome', { length: 255 })
})

export const assinDocumentos = pgTable('sys_mail_assin_documentos', {
  id: serial('id').primaryKey(),
  titulo: varchar('titulo', { length: 200 }).notNull(),
  mensagem: text('mensagem'),
  status: varchar('status', { length: 20 }).default('rascunho').notNull(),
  ordem: varchar('ordem', { length: 12 }).default('paralela').notNull(),
  assinarComoGaulke: boolean('assinar_como_gaulke').default(false).notNull(),
  certificadoId: integer('certificado_id').references(() => certificados.id, { onDelete: 'set null' }),
  prazo: date('prazo'),
  clienteNome: varchar('cliente_nome', { length: 200 }),
  clienteDocumento: varchar('cliente_documento', { length: 14 }),
  pasta: text('pasta'),
  originalPath: text('original_path'),
  originalNome: varchar('original_nome', { length: 260 }),
  originalSha256: char('original_sha256', { length: 64 }),
  originalPaginas: integer('original_paginas'),
  finalPath: text('final_path'),
  finalSha256: char('final_sha256', { length: 64 }),
  codigoVerificacao: varchar('codigo_verificacao', { length: 16 }).notNull(),
  contaId: integer('conta_id').references(() => accounts.id, { onDelete: 'set null' }),
  contaNome: varchar('conta_nome', { length: 120 }),
  responderPara: varchar('responder_para', { length: 300 }),
  criadoPorUserId: integer('criado_por_user_id'),
  criadoPorNome: varchar('criado_por_nome', { length: 255 }),
  criadoPorEmail: varchar('criado_por_email', { length: 320 }),
  enviadoEm: timestamp('enviado_em', { withTimezone: true }),
  concluidoEm: timestamp('concluido_em', { withTimezone: true }),
  finalizacaoErro: text('finalizacao_erro'),
  canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
  canceladoPorNome: varchar('cancelado_por_nome', { length: 255 }),
  canceladoMotivo: text('cancelado_motivo'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
})

export const assinSignatarios = pgTable('sys_mail_assin_signatarios', {
  id: serial('id').primaryKey(),
  documentoId: integer('documento_id')
    .notNull()
    .references(() => assinDocumentos.id, { onDelete: 'cascade' }),
  ordem: integer('ordem').default(1).notNull(),
  nome: varchar('nome', { length: 200 }).notNull(),
  email: varchar('email', { length: 320 }).notNull(),
  cpf: varchar('cpf', { length: 11 }),
  papel: varchar('papel', { length: 60 }),
  token: varchar('token', { length: 36 }).notNull(),
  status: varchar('status', { length: 20 }).default('pendente').notNull(),
  conviteEnviadoEm: timestamp('convite_enviado_em', { withTimezone: true }),
  envioErro: text('envio_erro'),
  visualizadoEm: timestamp('visualizado_em', { withTimezone: true }),
  otpHash: char('otp_hash', { length: 64 }),
  otpExpiraEm: timestamp('otp_expira_em', { withTimezone: true }),
  otpTentativas: integer('otp_tentativas').default(0).notNull(),
  otpEnviadoEm: timestamp('otp_enviado_em', { withTimezone: true }),
  otpValidadoEm: timestamp('otp_validado_em', { withTimezone: true }),
  tipoAssinatura: varchar('tipo_assinatura', { length: 12 }),
  nomeAssinatura: varchar('nome_assinatura', { length: 200 }),
  imagemAssinatura: text('imagem_assinatura'),
  assinadoEm: timestamp('assinado_em', { withTimezone: true }),
  recusadoEm: timestamp('recusado_em', { withTimezone: true }),
  recusaMotivo: text('recusa_motivo'),
  ip: varchar('ip', { length: 64 }),
  userAgent: text('user_agent'),
  lembretesEnviados: integer('lembretes_enviados').default(0).notNull(),
  ultimoLembreteEm: timestamp('ultimo_lembrete_em', { withTimezone: true })
})

export const assinCampos = pgTable('sys_mail_assin_campos', {
  id: serial('id').primaryKey(),
  documentoId: integer('documento_id')
    .notNull()
    .references(() => assinDocumentos.id, { onDelete: 'cascade' }),
  signatarioId: integer('signatario_id')
    .notNull()
    .references(() => assinSignatarios.id, { onDelete: 'cascade' }),
  tipo: varchar('tipo', { length: 12 }).default('assinatura').notNull(),
  pagina: integer('pagina').notNull(),
  x: real('x').notNull(),
  y: real('y').notNull(),
  largura: real('largura').notNull(),
  altura: real('altura').notNull()
})

export const assinEventos = pgTable('sys_mail_assin_eventos', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  documentoId: integer('documento_id')
    .notNull()
    .references(() => assinDocumentos.id, { onDelete: 'cascade' }),
  signatarioId: integer('signatario_id'),
  tipo: varchar('tipo', { length: 40 }).notNull(),
  descricao: text('descricao').notNull(),
  porNome: varchar('por_nome', { length: 255 }),
  ip: varchar('ip', { length: 64 }),
  userAgent: text('user_agent'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
  hashAnterior: char('hash_anterior', { length: 64 }),
  hash: char('hash', { length: 64 }).notNull()
})

/* -------------------------------------------------------------------------
 * Listas de contatos salvas e webhooks (Fase 8)
 * ---------------------------------------------------------------------- */

export const listas = pgTable('sys_mail_listas', {
  id: serial('id').primaryKey(),
  nome: varchar('nome', { length: 160 }).notNull(),
  descricao: text('descricao'),
  criadoPorUserId: integer('criado_por_user_id'),
  criadoPorNome: varchar('criado_por_nome', { length: 255 }),
  atualizadoPorNome: varchar('atualizado_por_nome', { length: 255 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).defaultNow().notNull()
})

export const listaMembros = pgTable('sys_mail_lista_membros', {
  id: serial('id').primaryKey(),
  listaId: integer('lista_id')
    .notNull()
    .references(() => listas.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 320 }).notNull(),
  nome: varchar('nome', { length: 200 }),
  empresa: varchar('empresa', { length: 200 }),
  documento: varchar('documento', { length: 20 }),
  extras: jsonb('extras').$type<Record<string, string> | null>(),
  adicionadoEm: timestamp('adicionado_em', { withTimezone: true }).defaultNow().notNull()
})

export const webhooks = pgTable('sys_mail_webhooks', {
  id: serial('id').primaryKey(),
  nome: varchar('nome', { length: 120 }).notNull(),
  url: text('url').notNull(),
  eventos: text('eventos').array().default(sql`'{}'`).notNull(),
  segredoCifrado: text('segredo_cifrado').notNull(),
  ativo: boolean('ativo').default(true).notNull(),
  ultimaEntregaEm: timestamp('ultima_entrega_em', { withTimezone: true }),
  ultimoStatus: integer('ultimo_status'),
  ultimoErro: text('ultimo_erro'),
  criadoPorNome: varchar('criado_por_nome', { length: 255 }),
  atualizadoPorNome: varchar('atualizado_por_nome', { length: 255 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).defaultNow().notNull()
})

export const webhookEntregas = pgTable('sys_mail_webhook_entregas', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  webhookId: integer('webhook_id')
    .notNull()
    .references(() => webhooks.id, { onDelete: 'cascade' }),
  entregaUuid: uuid('entrega_uuid').notNull(),
  evento: varchar('evento', { length: 60 }).notNull(),
  payload: jsonb('payload').notNull(),
  status: varchar('status', { length: 20 }).default('pendente').notNull(),
  tentativas: integer('tentativas').default(0).notNull(),
  proximaTentativaEm: timestamp('proxima_tentativa_em', { withTimezone: true }).defaultNow().notNull(),
  ultimoStatusHttp: integer('ultimo_status_http'),
  ultimoErro: text('ultimo_erro'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
  entregueEm: timestamp('entregue_em', { withTimezone: true })
})

export type Account = typeof accounts.$inferSelect
export type Template = typeof templates.$inferSelect
export type TemplateVersao = typeof templateVersoes.$inferSelect
export type Batch = typeof batches.$inferSelect
export type Recipient = typeof recipients.$inferSelect
export type Envio = typeof envios.$inferSelect

/** Pedido de reenvio que aguarda o worker (recipients.reenvio_pendente). */
export type ReenvioPendente = {
  motivo: string
  /** status antes de voltar para a fila: e para ele que volta se o reenvio falhar */
  statusAnterior: string
  porUserId: number | null
  porNome: string | null
  pedidoEm: string
  /** lembrete automatico (Fase 8): o assunto sai com "Lembrete:" na frente */
  lembrete?: boolean
}
export type MailEvent = typeof events.$inferSelect
export type Auditoria = typeof auditoria.$inferSelect
export type Solicitacao = typeof solicitacoes.$inferSelect
export type SolicItem = typeof solicItens.$inferSelect
export type SolicArquivo = typeof solicArquivos.$inferSelect
export type Certificado = typeof certificados.$inferSelect
export type AssinDocumento = typeof assinDocumentos.$inferSelect
export type AssinSignatario = typeof assinSignatarios.$inferSelect
export type AssinCampo = typeof assinCampos.$inferSelect
export type Lista = typeof listas.$inferSelect
export type ListaMembro = typeof listaMembros.$inferSelect
export type Webhook = typeof webhooks.$inferSelect
