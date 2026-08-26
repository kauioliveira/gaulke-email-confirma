import { eq } from 'drizzle-orm'
import { useDb, batches } from '../../../../db'
import { loteEmExecucao, pausarLote } from '../../../../utils/sender'

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  if (loteEmExecucao(id)) await pausarLote(id)
  // destinatarios e eventos caem junto por ON DELETE CASCADE
  await useDb().delete(batches).where(eq(batches.id, id))
  return { ok: true }
})
