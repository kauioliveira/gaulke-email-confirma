import { eq } from 'drizzle-orm'
import { useDb, templates } from '../../../db'
import { operadorAtual } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'
import {
  templateSchema,
  htmlDoTemplate,
  exigirPodeMexer,
  exigirPodeMarcarOficial,
  salvarVersao
} from '../../../utils/templates'

export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const id = Number(getRouterParam(event, 'id'))
  const dados = validar(templateSchema, await readBody(event))
  const db = useDb()

  const [antes] = await db.select().from(templates).where(eq(templates.id, id))
  if (!antes) throw createError({ statusCode: 404, statusMessage: 'Template nao encontrado' })
  exigirPodeMexer(event, antes, 'editá-lo')
  exigirPodeMarcarOficial(event, dados.oficial, antes.oficial)

  const html = htmlDoTemplate(dados)

  const [t] = await db
    .update(templates)
    .set({
      nome: dados.nome,
      assunto: dados.assunto,
      formato: dados.formato,
      blocos: (dados.blocos ?? null) as never,
      html,
      tipo: dados.tipo ?? antes.tipo,
      categoria: dados.categoria === undefined ? antes.categoria : dados.categoria || null,
      oficial: dados.oficial ?? antes.oficial,
      atualizadoPorUserId: op.id,
      atualizadoPorNome: op.nome,
      updatedAt: new Date()
    })
    .where(eq(templates.id, id))
    .returning()

  const versao = await salvarVersao(t!, op)

  // o conteudo inteiro nao vai para a trilha (pode ter dezenas de KB): ele
  // fica no historico de versoes
  const mudou = Object.fromEntries(
    (['nome', 'assunto', 'formato', 'tipo', 'categoria', 'oficial'] as const)
      .filter(k => antes[k] !== t![k])
      .map(k => [k, { de: antes[k], para: t![k] }])
  )
  await auditar(event, 'template.editar', {
    entidade: 'template',
    id,
    resumo: `Editou o template "${t!.nome}" (versão ${versao})`,
    dados: { ...mudou, versao }
  })
  return { template: t, versao }
})
