import { eq, sql } from 'drizzle-orm'
import { useDb, batches, recipients } from '../../../../db'
import { loteEmExecucao } from '../../../../utils/sender'

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const lote = (await useDb().select().from(batches).where(eq(batches.id, id)))[0]
  if (!lote) throw createError({ statusCode: 404, statusMessage: 'Lote nao encontrado' })

  const [contagem] = await useDb()
    .select({
      total: sql<number>`count(*)::int`,
      pendentes: sql<number>`count(*) filter (where ${recipients.status} = 'pendente')::int`,
      enviados: sql<number>`count(*) filter (where ${recipients.status} = 'enviado')::int`,
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
    .where(eq(recipients.batchId, id))

  return { lote: { ...lote, workerAtivo: loteEmExecucao(id) }, contagem }
})
