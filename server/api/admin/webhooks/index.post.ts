import { useDb, webhooks } from '../../../db'
import { exigirPapel } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'
import { novoSegredo, cifrarSegredo } from '../../../utils/webhooks'
import { webhookSchema } from '../../../utils/webhooks-schema'

/**
 * Novo webhook. O segredo do HMAC e gerado aqui e devolvido UMA vez: depois
 * fica so cifrado no banco, e perdido = gerar outro.
 */
export default defineEventHandler(async event => {
  const op = exigirPapel(event, 'admin', 'cadastrar webhooks')
  const d = validar(webhookSchema, await readBody(event))
  const segredo = novoSegredo()
  const [w] = await useDb()
    .insert(webhooks)
    .values({ ...d, segredoCifrado: cifrarSegredo(segredo), criadoPorNome: op.nome, atualizadoPorNome: op.nome })
    .returning({ id: webhooks.id })
  await auditar(event, 'webhook.criar', {
    entidade: 'webhook',
    id: w!.id,
    resumo: `Cadastrou o webhook "${d.nome}" (${d.url}) para ${d.eventos.includes('*') ? 'todos os eventos' : d.eventos.join(', ')}`,
    dados: { nome: d.nome, url: d.url, eventos: d.eventos, ativo: d.ativo }
  })
  return { id: w!.id, segredo }
})
