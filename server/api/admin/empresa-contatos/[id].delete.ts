import { and, eq, isNull } from 'drizzle-orm'
import { useDb, empresaContatos } from '../../../db'
import { operadorAtual } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'

/**
 * "Esquecer este e-mail" de uma empresa: a sugestao estava errada (o
 * contador saiu, o e-mail era de outra empresa). Nao apaga — marca
 * removido_em; um envio novo para o mesmo par traz o contato de volta.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const id = Number(getRouterParam(event, 'id'))
  const [c] = await useDb()
    .update(empresaContatos)
    .set({ removidoEm: new Date() })
    .where(and(eq(empresaContatos.id, id), isNull(empresaContatos.removidoEm)))
    .returning()
  if (!c) throw createError({ statusCode: 404, statusMessage: 'Contato não encontrado' })
  await auditar(event, 'empresa_contato.esquecer', {
    entidade: 'empresa_contato',
    id: c.id,
    resumo: `${op.nome} tirou ${c.email} das sugestões do documento ${formatarDocumento(c.documento)}`
  })
  return { ok: true }
})
