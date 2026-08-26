import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { useDb, batches, recipients, templates, accounts } from '../../../db'
import { novoToken, novoCodigo } from '../../../utils/ids'
import { caminhoNoStorage } from '../../../utils/storage'
import { stat } from 'node:fs/promises'
import { registrarEvento } from '../../../utils/tracking'

const schema = z.object({
  nome: z.string().min(1).max(200),
  templateId: z.number().int().optional().nullable(),
  // conta de envio; ausente usa a padrao das configuracoes
  contaId: z.number().int().optional().nullable(),
  assunto: z.string().min(1).max(300),
  html: z.string().min(1),
  arquivoNome: z.string().optional().nullable(),
  arquivoOriginal: z.string().optional().nullable(),
  intervaloMs: z.number().int().min(1000).max(600000).default(10000),
  exigirConfirmacao: z.boolean().default(true),
  pedirRecibo: z.boolean().default(false),
  // ISO 8601 com fuso; presente = o lote ja nasce agendado
  agendadoPara: z.string().datetime({ offset: true }).nullish(),
  // snapshot do editor visual, para reabrir o lote depois
  formato: z.enum(['blocos', 'html']).default('html'),
  blocos: z.array(z.any()).nullish(),
  destinatarios: z
    .array(
      z.object({
        email: z.string().email(),
        nome: z.string().optional().default(''),
        empresa: z.string().optional().default(''),
        extras: z.record(z.string()).optional()
      })
    )
    .min(1)
})

export default defineEventHandler(async event => {
  const dados = validar(schema, await readBody(event))
  const operador = event.context.operador
  const db = useDb()

  // valida o arquivo antes de criar o lote, para nao disparar link quebrado
  if (dados.arquivoNome) {
    const caminho = caminhoNoStorage(dados.arquivoNome)
    const info = await stat(caminho).catch(() => null)
    if (!info?.isFile()) {
      throw createError({ statusCode: 400, statusMessage: 'Arquivo do lote nao encontrado no servidor' })
    }
  }

  /**
   * A conta e resolvida na CRIACAO para o nome ficar gravado no lote, e para o
   * erro aparecer agora — e nao no meio do disparo, com metade da lista ja
   * enviada.
   */
  let contaId: number | null = null
  let contaNome: string | null = null
  if (dados.contaId) {
    const [c] = await db.select().from(accounts).where(eq(accounts.id, dados.contaId))
    if (!c) throw createError({ statusCode: 400, statusMessage: 'Conta de envio nao encontrada' })
    if (c.ativa !== 'true') {
      throw createError({ statusCode: 400, statusMessage: `A conta "${c.nome}" esta desativada` })
    }
    contaId = c.id
    contaNome = c.nome
  } else {
    const [padrao] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.padrao, 'true'), eq(accounts.ativa, 'true')))
      .limit(1)
    if (padrao) {
      contaId = padrao.id
      contaNome = padrao.nome
    }
  }

  if (dados.templateId) {
    const t = (await db.select({ id: templates.id }).from(templates).where(eq(templates.id, dados.templateId)))[0]
    if (!t) throw createError({ statusCode: 400, statusMessage: 'Template nao encontrado' })
  }

  const [lote] = await db
    .insert(batches)
    .values({
      nome: dados.nome,
      templateId: dados.templateId ?? null,
      // snapshot: o relatorio precisa mostrar exatamente o que foi enviado
      assuntoSnapshot: dados.assunto,
      htmlSnapshot: dados.html,
      formato: dados.formato,
      blocos: (dados.blocos ?? null) as never,
      // preenchido quando a pessoa entrou pela sessao do painel; com a senha
      // do .env nao ha quem registrar, e fica nulo
      criadoPorUserId: operador?.id ?? null,
      criadoPorNome: operador?.nome ?? null,
      contaId,
      contaNome,
      arquivoPath: dados.arquivoNome ?? null,
      arquivoNome: dados.arquivoOriginal || dados.arquivoNome || null,
      intervaloMs: dados.intervaloMs,
      exigirConfirmacao: dados.exigirConfirmacao ? 'true' : 'false',
      pedirRecibo: dados.pedirRecibo ? 'true' : 'false',
      status: dados.agendadoPara ? 'agendado' : 'rascunho',
      agendadoPara: dados.agendadoPara ? new Date(dados.agendadoPara) : null,
      agendadoEm: dados.agendadoPara ? new Date() : null,
      total: dados.destinatarios.length
    })
    .returning()

  // dedupe final no servidor: a UI pode ter sido burlada
  const vistos = new Set<string>()
  const linhas = []
  for (const d of dados.destinatarios) {
    const email = d.email.trim().toLowerCase()
    if (vistos.has(email)) continue
    vistos.add(email)
    linhas.push({
      batchId: lote!.id,
      email,
      nome: d.nome || null,
      empresa: d.empresa || null,
      dadosExtras: (d.extras && Object.keys(d.extras).length ? d.extras : null) as never,
      token: novoToken(),
      codigo: novoCodigo(),
      status: 'pendente'
    })
  }

  // insere em blocos para nao estourar o limite de parametros do Postgres
  const inseridos = []
  for (let i = 0; i < linhas.length; i += 500) {
    inseridos.push(...(await db.insert(recipients).values(linhas.slice(i, i + 500)).returning({ id: recipients.id })))
  }

  if (inseridos.length !== lote!.total) {
    await db.update(batches).set({ total: inseridos.length }).where(eq(batches.id, lote!.id))
  }
  await Promise.all(inseridos.map(r => registrarEvento(r.id, 'enfileirado')))

  return { lote: { ...lote!, total: inseridos.length }, destinatarios: inseridos.length }
})
