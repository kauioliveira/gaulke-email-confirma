import { eq, sql } from 'drizzle-orm'
import { useDb, listas, listaMembros } from '../../../../db'
import { operadorAtual, temPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { carregarLista } from '../../../../utils/listas'

/**
 * Exclui a lista (os contatos dela, nao os envios: cada lote guardou a sua
 * propria copia de quem recebeu). Quem criou, ou supervisor/admin.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const l = await carregarLista(Number(getRouterParam(event, 'id')))
  const eDono = l.criadoPorUserId === null || l.criadoPorUserId === op.id
  if (!eDono && !temPapel(op, 'supervisor')) {
    throw createError({
      statusCode: 403,
      statusMessage: `Somente quem criou a lista (${l.criadoPorNome}), supervisores e administradores podem excluí-la.`
    })
  }
  const [c] = await useDb().select({ n: sql<number>`count(*)::int` }).from(listaMembros).where(eq(listaMembros.listaId, l.id))
  await useDb().delete(listas).where(eq(listas.id, l.id))
  await auditar(event, 'lista.excluir', {
    entidade: 'lista',
    id: l.id,
    resumo: `Excluiu a lista "${l.nome}" (${c?.n ?? 0} contato(s))`,
    dados: { nome: l.nome, contatos: c?.n ?? 0, criadoPor: l.criadoPorNome }
  })
  return { ok: true }
})
