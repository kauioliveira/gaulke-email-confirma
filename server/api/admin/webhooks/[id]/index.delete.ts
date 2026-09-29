import { eq } from 'drizzle-orm'
import { useDb, webhooks } from '../../../../db'
import { exigirPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'

/** Exclui o webhook e a fila dele (entregas pendentes nao saem mais). */
export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'excluir webhooks')
  const id = Number(getRouterParam(event, 'id'))
  const [w] = await useDb().delete(webhooks).where(eq(webhooks.id, id)).returning()
  if (!w) throw createError({ statusCode: 404, statusMessage: 'Webhook não encontrado' })
  await auditar(event, 'webhook.excluir', {
    entidade: 'webhook',
    id,
    resumo: `Excluiu o webhook "${w.nome}" (${w.url})`,
    dados: { nome: w.nome, url: w.url, eventos: w.eventos }
  })
  return { ok: true }
})
