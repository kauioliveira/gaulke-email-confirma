import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb, batches } from '../../../../db'

const schema = z.object({ intervaloMs: z.number().int().min(1000).max(600000) })

/** O intervalo pode ser ajustado com o lote rodando: o worker le a cada volta. */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const { intervaloMs } = schema.parse(await readBody(event))
  const [lote] = await useDb().update(batches).set({ intervaloMs }).where(eq(batches.id, id)).returning()
  if (!lote) throw createError({ statusCode: 404, statusMessage: 'Lote nao encontrado' })
  return { ok: true, intervaloMs: lote.intervaloMs }
})
