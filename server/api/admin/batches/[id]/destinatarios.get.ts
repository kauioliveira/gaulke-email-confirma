import { eq, and, desc, asc, or, ilike, sql, type SQL } from 'drizzle-orm'
import { useDb, recipients } from '../../../../db'

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const q = getQuery(event)
  const pagina = Math.max(1, Number(q.pagina || 1))
  const porPagina = Math.min(200, Math.max(10, Number(q.porPagina || 50)))
  const busca = String(q.busca || '').trim()
  const status = String(q.status || '').trim()

  const filtros: SQL[] = [eq(recipients.batchId, id)]
  if (status) filtros.push(eq(recipients.status, status))
  if (busca) {
    filtros.push(
      or(
        ilike(recipients.email, `%${busca}%`),
        ilike(recipients.nome, `%${busca}%`),
        ilike(recipients.codigo, `%${busca}%`)
      )!
    )
  }
  const where = and(...filtros)

  const total =
    (
      await useDb()
        .select({ total: sql<number>`count(*)::int` })
        .from(recipients)
        .where(where)
    )[0]?.total ?? 0

  const lista = await useDb()
    .select()
    .from(recipients)
    .where(where)
    .orderBy(q.ordem === 'recentes' ? desc(recipients.sentAt) : asc(recipients.id))
    .limit(porPagina)
    .offset((pagina - 1) * porPagina)

  return { destinatarios: lista, total, pagina, porPagina }
})
