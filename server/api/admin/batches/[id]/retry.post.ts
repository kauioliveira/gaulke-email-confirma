import { eq } from 'drizzle-orm'
import { useDb, batches } from '../../../../db'
import { reenviarFalhas } from '../../../../utils/sender'
import { auditar } from '../../../../utils/auditoria'

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const [lote] = await useDb().select({ excluidoEm: batches.excluidoEm }).from(batches).where(eq(batches.id, id))
  if (!lote || lote.excluidoEm) throw createError({ statusCode: 404, statusMessage: 'Lote nao encontrado' })
  const r = await reenviarFalhas(id)
  if (r.reenfileirados) {
    const [lote] = await useDb().select({ nome: batches.nome }).from(batches).where(eq(batches.id, id))
    await auditar(event, 'lote.reenviar_falhas', {
      entidade: 'lote',
      id,
      resumo: `Recolocou na fila ${r.reenfileirados} falha(s) do lote "${lote?.nome ?? id}"`,
      dados: { reenfileirados: r.reenfileirados }
    })
  }
  return r
})
