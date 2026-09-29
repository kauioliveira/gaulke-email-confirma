import { eq, and, desc, asc, or, ilike, sql, getTableColumns, type SQL } from 'drizzle-orm'
import { useDb, recipients, batches } from '../../../../db'
import { temPapel } from '../../../../utils/permissoes'

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const [lote] = await useDb().select({ excluidoEm: batches.excluidoEm }).from(batches).where(eq(batches.id, id))
  if (!lote || (lote.excluidoEm && !temPapel(event.context.operador, 'admin'))) {
    throw createError({ statusCode: 404, statusMessage: 'Lote nao encontrado' })
  }
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
    .select({
      ...getTableColumns(recipients),
      // quantos e-mails ja sairam para a pessoa (original + reenvios). A
      // coluna vai qualificada A MAO: dentro de sql`` o drizzle escreve so
      // "id", que na subconsulta seria o id de sys_mail_envios
      envios: sql<number>`(select count(*)::int from sys_mail_envios e
                            where e.recipient_id = sys_mail_recipients.id and e.status = 'enviado')`
    })
    .from(recipients)
    .where(where)
    .orderBy(q.ordem === 'recentes' ? desc(recipients.sentAt) : asc(recipients.id))
    .limit(porPagina)
    .offset((pagina - 1) * porPagina)

  return { destinatarios: lista, total, pagina, porPagina }
})
