import { eq, desc, asc, sql } from 'drizzle-orm'
import { useDb, recipients, batches } from '../../../db'
import { lerFiltros, montarWhere, colunasRelatorio, ultimoIp } from '../../../utils/relatorio'

export default defineEventHandler(async event => {
  const q = getQuery(event)
  const f = lerFiltros(q as Record<string, unknown>)
  const pagina = Math.max(1, Number(q.pagina || 1))
  const porPagina = Math.min(200, Math.max(10, Number(q.porPagina || 50)))
  const where = montarWhere(f)
  const db = useDb()

  const total =
    (
      await db
        .select({ total: sql<number>`count(*)::int` })
        .from(recipients)
        .innerJoin(batches, eq(batches.id, recipients.batchId))
        .where(where)
    )[0]?.total ?? 0

  const linhas = await db
    .select({ ...colunasRelatorio, ultimoIp })
    .from(recipients)
    .innerJoin(batches, eq(batches.id, recipients.batchId))
    .where(where)
    .orderBy(q.ordem === 'antigos' ? asc(recipients.id) : desc(recipients.id))
    .limit(porPagina)
    .offset((pagina - 1) * porPagina)

  const [resumo] = await db
    .select({
      total: sql<number>`count(*)::int`,
      enviados: sql<number>`count(${recipients.sentAt})::int`,
      erros: sql<number>`count(*) filter (where ${recipients.status} = 'erro')::int`,
      aberturas: sql<number>`count(${recipients.firstOpenAt})::int`,
      aberturasPessoa: sql<number>`count(${recipients.firstHumanOpenAt})::int`,
      aberturasMaquina: sql<number>`count(*) filter (
        where ${recipients.firstOpenAt} is not null
          and ${recipients.firstHumanOpenAt} is null)::int`,
      acessos: sql<number>`count(${recipients.firstAccessAt})::int`,
      confirmacoes: sql<number>`count(${recipients.confirmedAt})::int`,
      downloads: sql<number>`count(${recipients.firstDownloadAt})::int`
    })
    .from(recipients)
    .innerJoin(batches, eq(batches.id, recipients.batchId))
    .where(where)

  return { linhas, total, pagina, porPagina, resumo }
})
