import { desc, eq } from 'drizzle-orm'
import { useDb, templateVersoes } from '../../../../db'

/** Historico de versoes de um template, da mais nova para a mais antiga. */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const versoes = await useDb()
    .select({
      versao: templateVersoes.versao,
      nome: templateVersoes.nome,
      assunto: templateVersoes.assunto,
      formato: templateVersoes.formato,
      tipo: templateVersoes.tipo,
      categoria: templateVersoes.categoria,
      salvoPorNome: templateVersoes.salvoPorNome,
      salvoEm: templateVersoes.salvoEm
    })
    .from(templateVersoes)
    .where(eq(templateVersoes.templateId, id))
    .orderBy(desc(templateVersoes.versao))
  return { versoes }
})
