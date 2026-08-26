import { eq, asc } from 'drizzle-orm'
import { useDb, recipients, batches, events } from '../../../db'
import { linkAcesso } from '../../../utils/urls'

/** Ficha individual: todos os eventos com IP, user-agent e horario. */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))

  const linha = (
    await useDb()
      .select({
        destinatario: recipients,
        loteNome: batches.nome,
        loteId: batches.id,
        arquivoNome: batches.arquivoNome,
        assunto: batches.assuntoSnapshot,
        html: batches.htmlSnapshot
      })
      .from(recipients)
      .innerJoin(batches, eq(batches.id, recipients.batchId))
      .where(eq(recipients.id, id))
  )[0]

  if (!linha) throw createError({ statusCode: 404, statusMessage: 'Destinatario nao encontrado' })

  const timeline = await useDb()
    .select()
    .from(events)
    .where(eq(events.recipientId, id))
    .orderBy(asc(events.createdAt), asc(events.id))

  return {
    ...linha,
    link: linkAcesso(linha.destinatario.token),
    timeline
  }
})
