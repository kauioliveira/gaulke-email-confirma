import { desc } from 'drizzle-orm'
import { useDb, batches } from '../../../db'

/**
 * Lista enxuta para preencher combos ("filtrar por lote").
 *
 * Existe separada porque a listagem principal virou PAGINADA: se os combos
 * continuassem consumindo aquele endpoint, passariam a mostrar apenas os
 * lotes da primeira pagina — e os antigos sumiriam do filtro sem aviso.
 */
export default defineEventHandler(async () => {
  const lotes = await useDb()
    .select({ id: batches.id, nome: batches.nome, status: batches.status })
    .from(batches)
    .orderBy(desc(batches.createdAt))
    .limit(500)

  return { lotes }
})
