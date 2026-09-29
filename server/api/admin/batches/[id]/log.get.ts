import { and, desc, eq, inArray } from 'drizzle-orm'
import { useDb, batches, recipients, events } from '../../../../db'
import { temPapel } from '../../../../utils/permissoes'

/**
 * Log PERMANENTE do disparo: cada envio, reenvio e falha, com a resposta do
 * servidor SMTP. O log ao vivo (SSE) so mostra o que acontece com a tela
 * aberta; este e o que sobra depois, para depurar "o cliente nao recebeu".
 */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const [lote] = await useDb().select({ excluidoEm: batches.excluidoEm }).from(batches).where(eq(batches.id, id))
  if (!lote || (lote.excluidoEm && !temPapel(event.context.operador, 'admin'))) {
    throw createError({ statusCode: 404, statusMessage: 'Lote nao encontrado' })
  }

  const linhas = await useDb()
    .select({
      id: events.id,
      tipo: events.tipo,
      meta: events.meta,
      at: events.createdAt,
      recipientId: recipients.id,
      email: recipients.email,
      codigo: recipients.codigo
    })
    .from(events)
    .innerJoin(recipients, eq(recipients.id, events.recipientId))
    .where(and(eq(recipients.batchId, id), inArray(events.tipo, ['enviado', 'reenvio', 'erro'])))
    .orderBy(desc(events.id))
    .limit(300)

  return { log: linhas }
})
