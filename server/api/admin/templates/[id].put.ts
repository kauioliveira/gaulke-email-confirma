import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb, templates } from '../../../db'
import { blocosSchema } from '../../../utils/blocos-schema'
import { renderizarBlocos } from '../../../utils/blocos'

const schema = z.object({
  nome: z.string().min(1).max(160),
  assunto: z.string().min(1).max(300),
  formato: z.enum(['blocos', 'html']).default('html'),
  html: z.string().optional(),
  blocos: blocosSchema.optional()
})

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const dados = validar(schema, await readBody(event))

  const html =
    dados.formato === 'blocos'
      ? renderizarBlocos(dados.blocos ?? [], dados.assunto)
      : dados.html

  if (!html) {
    throw createError({ statusCode: 400, statusMessage: 'Informe o HTML ou os blocos' })
  }

  const [t] = await useDb()
    .update(templates)
    .set({
      nome: dados.nome,
      assunto: dados.assunto,
      formato: dados.formato,
      blocos: (dados.blocos ?? null) as never,
      html,
      updatedAt: new Date()
    })
    .where(eq(templates.id, id))
    .returning()

  if (!t) throw createError({ statusCode: 404, statusMessage: 'Template nao encontrado' })
  return { template: t }
})
