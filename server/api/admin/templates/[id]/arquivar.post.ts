import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb, templates } from '../../../../db'
import { auditar } from '../../../../utils/auditoria'
import { exigirPodeMexer } from '../../../../utils/templates'

const schema = z.object({ arquivar: z.boolean() })

/**
 * Arquiva ou desarquiva um template. Arquivado some da lista e da escolha no
 * novo envio, mas continua existindo — e a saida de quem nao pode excluir um
 * template ja usado. Lotes nao sao afetados (guardam o proprio snapshot).
 */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const { arquivar } = validar(schema, await readBody(event))
  const db = useDb()

  const [t] = await db.select().from(templates).where(eq(templates.id, id))
  if (!t) throw createError({ statusCode: 404, statusMessage: 'Template nao encontrado' })
  exigirPodeMexer(event, t, arquivar ? 'arquivá-lo' : 'desarquivá-lo')

  await db.update(templates).set({ arquivadoEm: arquivar ? new Date() : null }).where(eq(templates.id, id))
  await auditar(event, arquivar ? 'template.arquivar' : 'template.desarquivar', {
    entidade: 'template',
    id,
    resumo: `${arquivar ? 'Arquivou' : 'Desarquivou'} o template "${t.nome}"`
  })
  return { ok: true }
})
