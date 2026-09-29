import { eq } from 'drizzle-orm'
import { useDb, batches } from '../../../../db'
import { pausarLote } from '../../../../utils/sender'
import { auditar } from '../../../../utils/auditoria'

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const r = await pausarLote(id)
  const [lote] = await useDb().select({ nome: batches.nome }).from(batches).where(eq(batches.id, id))
  await auditar(event, 'lote.pausar', { entidade: 'lote', id, resumo: `Pausou o lote "${lote?.nome ?? id}"` })
  return r
})
