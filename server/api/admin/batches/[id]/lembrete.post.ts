import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb, batches } from '../../../../db'
import { auditar } from '../../../../utils/auditoria'

const schema = z.object({
  // nulo = desligar
  lembrete: z.object({ dias: z.number().int().min(1).max(30), max: z.number().int().min(1).max(5) }).nullable()
})

/**
 * Liga, muda ou desliga o lembrete automatico de um lote ja criado. Quem ja
 * recebeu lembretes continua contando: subir o maximo de 2 para 3 manda so
 * mais um.
 */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const { lembrete } = validar(schema, await readBody(event))
  const db = useDb()
  const [antes] = await db.select().from(batches).where(eq(batches.id, id))
  if (!antes || antes.excluidoEm) throw createError({ statusCode: 404, statusMessage: 'Lote nao encontrado' })
  await db
    .update(batches)
    .set({ lembreteDias: lembrete?.dias ?? null, lembreteMax: lembrete?.max ?? 0 })
    .where(eq(batches.id, id))
  const descrever = (d: number | null, m: number) => (d && m ? `a cada ${d} dia(s), até ${m}x` : 'desligado')
  await auditar(event, 'lote.lembrete', {
    entidade: 'lote',
    id,
    resumo: `Lembrete automático do lote "${antes.nome}": ${descrever(antes.lembreteDias, antes.lembreteMax)} → ${descrever(lembrete?.dias ?? null, lembrete?.max ?? 0)}`,
    dados: { de: { dias: antes.lembreteDias, max: antes.lembreteMax }, para: lembrete }
  })
  return { ok: true }
})
