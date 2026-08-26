import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { useDb, batches, recipients } from '../../../../db'
import { smtpConfig } from '../../../../utils/mailer'
import { checarBaseUrl } from '../../../../utils/urls'
import { loteEmExecucao } from '../../../../utils/sender'

const schema = z.object({
  /** ISO 8601 com fuso. `null` cancela o agendamento. */
  agendadoPara: z.string().datetime({ offset: true }).nullable()
})

/** 1 min de folga: o relogio do navegador nao e o mesmo do servidor. */
const FOLGA_MS = 60_000

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const { agendadoPara } = schema.parse(await readBody(event))
  const db = useDb()

  const lote = (await db.select().from(batches).where(eq(batches.id, id)))[0]
  if (!lote) throw createError({ statusCode: 404, statusMessage: 'Lote nao encontrado' })

  // ---- cancelar ----
  if (agendadoPara === null) {
    if (lote.status !== 'agendado') {
      throw createError({ statusCode: 400, statusMessage: 'Este lote nao esta agendado' })
    }
    const [atualizado] = await db
      .update(batches)
      .set({ status: 'rascunho', agendadoPara: null, agendadoEm: null, observacao: null })
      .where(eq(batches.id, id))
      .returning()
    return { ok: true, lote: atualizado }
  }

  // ---- agendar ----
  if (loteEmExecucao(id) || lote.status === 'enviando') {
    throw createError({ statusCode: 400, statusMessage: 'O lote ja esta disparando' })
  }
  if (!smtpConfig().enabled) {
    throw createError({ statusCode: 400, statusMessage: 'SMTP desabilitado (NUXT_SMTP_ENABLED=false)' })
  }

  const quando = new Date(agendadoPara)
  if (quando.getTime() < Date.now() - FOLGA_MS) {
    throw createError({ statusCode: 400, statusMessage: 'A data escolhida ja passou' })
  }

  // agendar um lote sem fila deixaria o horario chegar e nada acontecer
  const pendentes =
    (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(recipients)
        .where(and(eq(recipients.batchId, id), eq(recipients.status, 'pendente')))
    )[0]?.n ?? 0

  if (!pendentes) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nao ha destinatarios pendentes neste lote'
    })
  }

  const [atualizado] = await db
    .update(batches)
    .set({
      status: 'agendado',
      agendadoPara: quando,
      agendadoEm: new Date(),
      observacao: null
    })
    .where(eq(batches.id, id))
    .returning()

  // mesmo aviso do disparo manual: link publico invalido quebra o e-mail todo
  return { ok: true, lote: atualizado, pendentes, aviso: checarBaseUrl() }
})
