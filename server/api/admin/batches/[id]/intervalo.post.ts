import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb, batches } from '../../../../db'
import { auditar } from '../../../../utils/auditoria'

const schema = z.object({ intervaloMs: z.number().int().min(1000).max(600000) })

/** O intervalo pode ser ajustado com o lote rodando: o worker le a cada volta. */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const { intervaloMs } = validar(schema, await readBody(event))
  const db = useDb()
  const [antes] = await db.select({ intervaloMs: batches.intervaloMs }).from(batches).where(eq(batches.id, id))
  const [lote] = await db.update(batches).set({ intervaloMs }).where(eq(batches.id, id)).returning()
  if (!lote) throw createError({ statusCode: 404, statusMessage: 'Lote nao encontrado' })
  await auditar(event, 'lote.intervalo', {
    entidade: 'lote',
    id,
    resumo: `Mudou o intervalo do lote "${lote.nome}" de ${(antes?.intervaloMs ?? 0) / 1000}s para ${intervaloMs / 1000}s`,
    dados: { de: antes?.intervaloMs ?? null, para: intervaloMs }
  })
  return { ok: true, intervaloMs: lote.intervaloMs }
})
