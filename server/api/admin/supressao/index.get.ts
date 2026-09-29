import { desc, ilike } from 'drizzle-orm'
import { useDb, supressao } from '../../../db'

/** Enderecos suprimidos (devolveram definitivamente, ou adicionados a mao). */
export default defineEventHandler(async event => {
  const busca = String(getQuery(event).busca || '').trim().toLowerCase()
  const lista = await useDb()
    .select()
    .from(supressao)
    .where(busca ? ilike(supressao.email, `%${busca}%`) : undefined)
    .orderBy(desc(supressao.criadoEm))
    .limit(500)
  return { enderecos: lista }
})
