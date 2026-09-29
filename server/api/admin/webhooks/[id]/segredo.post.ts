import { eq } from 'drizzle-orm'
import { useDb, webhooks } from '../../../../db'
import { exigirPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { novoSegredo, cifrarSegredo } from '../../../../utils/webhooks'

/** Gera outro segredo (o antigo para de valer na hora). Mostrado uma vez so. */
export default defineEventHandler(async event => {
  const op = exigirPapel(event, 'admin', 'trocar o segredo de um webhook')
  const id = Number(getRouterParam(event, 'id'))
  const segredo = novoSegredo()
  const [w] = await useDb()
    .update(webhooks)
    .set({ segredoCifrado: cifrarSegredo(segredo), atualizadoPorNome: op.nome, atualizadoEm: new Date() })
    .where(eq(webhooks.id, id))
    .returning({ nome: webhooks.nome })
  if (!w) throw createError({ statusCode: 404, statusMessage: 'Webhook não encontrado' })
  await auditar(event, 'webhook.segredo', { entidade: 'webhook', id, resumo: `Gerou um novo segredo para o webhook "${w.nome}"` })
  return { segredo }
})
