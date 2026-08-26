import { desc } from 'drizzle-orm'
import { useDb, batches } from '../../../db'
import { lotesEmExecucao } from '../../../utils/sender'

export default defineEventHandler(async () => {
  const lista = await useDb().select().from(batches).orderBy(desc(batches.createdAt)).limit(200)
  const ativos = new Set(lotesEmExecucao())
  return { lotes: lista.map(l => ({ ...l, workerAtivo: ativos.has(l.id) })) }
})
