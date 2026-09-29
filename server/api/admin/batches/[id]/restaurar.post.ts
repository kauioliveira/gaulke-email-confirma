import { eq } from 'drizzle-orm'
import { useDb, batches } from '../../../../db'
import { exigirPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'

/**
 * Tira um lote da lixeira. So admin.
 *
 * Volta tudo: o lote reaparece nas telas e relatorios, e os links dos
 * destinatarios voltam a abrir. Um lote que estava rodando volta PAUSADO —
 * restaurar nao dispara nada sozinho.
 */
export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'restaurar lotes da lixeira')
  const id = Number(getRouterParam(event, 'id'))

  const [lote] = await useDb().select().from(batches).where(eq(batches.id, id))
  if (!lote?.excluidoEm) throw createError({ statusCode: 404, statusMessage: 'Este lote nao esta na lixeira' })

  await useDb()
    .update(batches)
    .set({ excluidoEm: null, excluidoPorNome: null, excluidoMotivo: null })
    .where(eq(batches.id, id))

  await auditar(event, 'lote.restaurar', {
    entidade: 'lote',
    id,
    resumo: `Restaurou da lixeira o lote "${lote.nome}" (excluído por ${lote.excluidoPorNome})`,
    dados: { excluidoEm: lote.excluidoEm, excluidoPor: lote.excluidoPorNome, motivo: lote.excluidoMotivo }
  })
  return { ok: true }
})
