import { and, eq } from 'drizzle-orm'
import { useDb, templates, templateVersoes } from '../../../../../../db'
import { operadorAtual } from '../../../../../../utils/permissoes'
import { auditar } from '../../../../../../utils/auditoria'
import { exigirPodeMexer, salvarVersao } from '../../../../../../utils/templates'
import { renderizarBlocos } from '../../../../../../utils/blocos'

/**
 * Volta o template ao conteudo de uma versao antiga. Nao apaga nada: a
 * restauracao vira uma versao NOVA, e a que estava em vigor continua no
 * historico — da para desfazer a restauracao do mesmo jeito.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const id = Number(getRouterParam(event, 'id'))
  const numero = Number(getRouterParam(event, 'versao'))
  const db = useDb()

  const [t] = await db.select().from(templates).where(eq(templates.id, id))
  if (!t) throw createError({ statusCode: 404, statusMessage: 'Template nao encontrado' })
  exigirPodeMexer(event, t, 'restaurar versões')

  const [v] = await db
    .select()
    .from(templateVersoes)
    .where(and(eq(templateVersoes.templateId, id), eq(templateVersoes.versao, numero)))
  if (!v) throw createError({ statusCode: 404, statusMessage: 'Versao nao encontrada' })

  // blocos: o HTML e regerado com a arte de hoje, como em qualquer salvamento
  const html =
    v.formato === 'blocos' && Array.isArray(v.blocos) ? renderizarBlocos(v.blocos as never, v.assunto) : v.html

  const [restaurado] = await db
    .update(templates)
    .set({
      nome: v.nome,
      assunto: v.assunto,
      formato: v.formato,
      blocos: v.blocos as never,
      html,
      tipo: v.tipo,
      categoria: v.categoria,
      atualizadoPorUserId: op.id,
      atualizadoPorNome: op.nome,
      updatedAt: new Date()
    })
    .where(eq(templates.id, id))
    .returning()

  const nova = await salvarVersao(restaurado!, op)
  await auditar(event, 'template.restaurar_versao', {
    entidade: 'template',
    id,
    resumo: `Restaurou o template "${restaurado!.nome}" para a versão ${numero} (agora versão ${nova})`,
    dados: { restaurada: numero, novaVersao: nova }
  })
  return { template: restaurado, versao: nova }
})
