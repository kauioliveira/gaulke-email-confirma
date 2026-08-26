import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb, templates } from '../../../db'

const schema = z.object({
  nome: z.string().min(1).max(160),
  assunto: z.string().min(1).max(300),
  html: z.string().min(1)
})

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const dados = schema.parse(await readBody(event))
  const [t] = await useDb()
    .update(templates)
    .set({ ...dados, updatedAt: new Date() })
    .where(eq(templates.id, id))
    .returning()
  if (!t) throw createError({ statusCode: 404, statusMessage: 'Template nao encontrado' })
  return { template: t }
})
