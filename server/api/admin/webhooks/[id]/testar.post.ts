import { eq } from 'drizzle-orm'
import { useDb, webhooks } from '../../../../db'
import { exigirPapel } from '../../../../utils/permissoes'
import { testarWebhook } from '../../../../utils/webhooks'

/** Manda um evento "teste" agora e devolve o que o outro lado respondeu. */
export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'testar webhooks')
  const [w] = await useDb().select().from(webhooks).where(eq(webhooks.id, Number(getRouterParam(event, 'id'))))
  if (!w) throw createError({ statusCode: 404, statusMessage: 'Webhook não encontrado' })
  return testarWebhook(w)
})
