import { eq } from 'drizzle-orm'
import { useDb, webhooks } from '../../../../db'
import { exigirPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { webhookSchema } from '../../../../utils/webhooks-schema'

export default defineEventHandler(async event => {
  const op = exigirPapel(event, 'admin', 'alterar webhooks')
  const id = Number(getRouterParam(event, 'id'))
  const d = validar(webhookSchema, await readBody(event))
  const [antes] = await useDb().select().from(webhooks).where(eq(webhooks.id, id))
  if (!antes) throw createError({ statusCode: 404, statusMessage: 'Webhook não encontrado' })
  await useDb()
    .update(webhooks)
    .set({ ...d, atualizadoPorNome: op.nome, atualizadoEm: new Date() })
    .where(eq(webhooks.id, id))
  await auditar(event, 'webhook.editar', {
    entidade: 'webhook',
    id,
    resumo: antes.ativo !== d.ativo && antes.url === d.url
      ? `${d.ativo ? 'Ligou' : 'Desligou'} o webhook "${d.nome}"`
      : `Alterou o webhook "${d.nome}"`,
    dados: { de: { nome: antes.nome, url: antes.url, eventos: antes.eventos, ativo: antes.ativo }, para: d }
  })
  return { ok: true }
})
