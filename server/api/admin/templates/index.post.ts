import { z } from 'zod'
import { useDb, templates } from '../../../db'

const schema = z.object({
  nome: z.string().min(1).max(160),
  assunto: z.string().min(1).max(300),
  html: z.string().min(1)
})

export default defineEventHandler(async event => {
  const dados = schema.parse(await readBody(event))
  const [t] = await useDb().insert(templates).values(dados).returning()
  return { template: t }
})
