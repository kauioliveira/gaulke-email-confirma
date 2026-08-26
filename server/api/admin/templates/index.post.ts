import { z } from 'zod'
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
  const dados = validar(schema, await readBody(event))

  // Em modo blocos o HTML e GERADO, nunca recebido: e isso que garante que a
  // marcacao de tabelas continue correta para o Outlook.
  const html =
    dados.formato === 'blocos'
      ? renderizarBlocos(dados.blocos ?? [], dados.assunto)
      : dados.html

  if (!html) {
    throw createError({ statusCode: 400, statusMessage: 'Informe o HTML ou os blocos' })
  }

  const [t] = await useDb()
    .insert(templates)
    .values({
      nome: dados.nome,
      assunto: dados.assunto,
      formato: dados.formato,
      blocos: (dados.blocos ?? null) as never,
      html
    })
    .returning()

  return { template: t }
})
