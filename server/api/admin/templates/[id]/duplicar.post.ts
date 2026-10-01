import { eq } from 'drizzle-orm'
import { useDb, templates } from '../../../../db'
import { operadorAtual } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { salvarVersao } from '../../../../utils/templates'

/**
 * Cria uma copia editavel. E o caminho mais comum para um template novo — e o
 * unico para quem quer partir de um template oficial sem poder altera-lo. A
 * copia nunca nasce oficial e pertence a quem duplicou (e ao setor dele).
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const id = Number(getRouterParam(event, 'id'))
  const db = useDb()

  const [t] = await db.select().from(templates).where(eq(templates.id, id))
  if (!t) throw createError({ statusCode: 404, statusMessage: 'Template nao encontrado' })

  const nome = `Cópia de ${t.nome}`.slice(0, 160)
  const [copia] = await db
    .insert(templates)
    .values({
      nome,
      assunto: t.assunto,
      formato: t.formato,
      blocos: t.blocos as never,
      html: t.html,
      tipo: t.tipo,
      categoria: t.categoria,
      oficial: false,
      departamentoId: op.departamentoId,
      criadoPorUserId: op.id,
      criadoPorNome: op.nome,
      atualizadoPorUserId: op.id,
      atualizadoPorNome: op.nome
    })
    .returning()

  await salvarVersao(copia!, op)
  await auditar(event, 'template.duplicar', {
    entidade: 'template',
    id: copia!.id,
    resumo: `Duplicou o template "${t.nome}" como "${nome}"`,
    dados: { origem: t.id }
  })
  return { template: copia }
})
