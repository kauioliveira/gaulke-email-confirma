import { eq } from 'drizzle-orm'
import { useDb, webhookEntregas } from '../../../../../db'
import { exigirPapel } from '../../../../../utils/permissoes'
import { auditar } from '../../../../../utils/auditoria'

/** Devolve uma entrega que desistiu para a fila (com o mesmo id: o n8n reconhece a repetida). */
export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'reenviar entregas de webhook')
  const id = Number(getRouterParam(event, 'id'))
  const [e] = await useDb()
    .update(webhookEntregas)
    .set({ status: 'pendente', tentativas: 0, proximaTentativaEm: new Date(), ultimoErro: null })
    .where(eq(webhookEntregas.id, id))
    .returning({ evento: webhookEntregas.evento, webhookId: webhookEntregas.webhookId })
  if (!e) throw createError({ statusCode: 404, statusMessage: 'Entrega não encontrada' })
  await auditar(event, 'webhook.reenviar', { entidade: 'webhook', id: e.webhookId, resumo: `Reenviou a entrega #${id} (${e.evento})` })
  return { ok: true }
})
