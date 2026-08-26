import { sql } from 'drizzle-orm'
import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  jsonb,
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
    contaNome: varchar('conta_nome', { length: 120 })
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

export type Account = typeof accounts.$inferSelect
export type Template = typeof templates.$inferSelect
export type Batch = typeof batches.$inferSelect
export type Recipient = typeof recipients.$inferSelect
export type MailEvent = typeof events.$inferSelect
