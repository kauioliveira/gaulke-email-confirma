import { eq, sql } from 'drizzle-orm'
import { useDb, checklists } from '../../../db'
import { operadorAtual, temPapel } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'

/**
 * Arquiva um modelo (some da lista de escolha). Nunca apaga: as solicitacoes
 * feitas com ele continuam dizendo de onde vieram.
 *
 * Modelo ja usado so e arquivado por supervisor/admin — a mesma regra dos
 * templates. `?restaurar=1` traz de volta.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const id = Number(getRouterParam(event, 'id'))
  const restaurar = getQuery(event).restaurar === '1'
  const db = useDb()
  const [m] = await db
    .select({ m: checklists, usos: sql<number>`(select count(*)::int from sys_mail_solic s where s.checklist_id = ${id})` })
    .from(checklists)
    .where(eq(checklists.id, id))
  if (!m) throw createError({ statusCode: 404, statusMessage: 'Modelo não encontrado' })
  if (!restaurar && m.usos > 0 && !temPapel(op, 'supervisor')) {
    throw createError({
      statusCode: 403,
      statusMessage: `Este modelo já foi usado em ${m.usos} solicitação(ões). Só supervisores e administradores podem arquivá-lo.`
    })
  }

  await db.update(checklists).set({ ativo: restaurar, atualizadoPorNome: op.nome, updatedAt: new Date() }).where(eq(checklists.id, id))
  await auditar(event, restaurar ? 'checklist.restaurar' : 'checklist.arquivar', {
    entidade: 'checklist',
    id,
    resumo: `${restaurar ? 'Restaurou' : 'Arquivou'} o modelo de checklist "${m.m.nome}"`
  })
  return { ok: true }
})
