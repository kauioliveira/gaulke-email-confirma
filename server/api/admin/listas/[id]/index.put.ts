import { eq } from 'drizzle-orm'
import { useDb, listas } from '../../../../db'
import { operadorAtual } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { carregarLista, listaSchema, erroNomeRepetido } from '../../../../utils/listas'

/** Renomeia ou muda a descricao. */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const antes = await carregarLista(Number(getRouterParam(event, 'id')))
  const d = validar(listaSchema, await readBody(event))
  try {
    await useDb()
      .update(listas)
      .set({ nome: d.nome, descricao: d.descricao || null, atualizadoPorNome: op.nome, atualizadoEm: new Date() })
      .where(eq(listas.id, antes.id))
  } catch (e) {
    if (erroNomeRepetido(e)) throw createError({ statusCode: 409, statusMessage: `Já existe uma lista chamada "${d.nome}".` })
    throw e
  }
  await auditar(event, 'lista.editar', {
    entidade: 'lista',
    id: antes.id,
    resumo: antes.nome === d.nome ? `Editou a lista "${d.nome}"` : `Renomeou a lista "${antes.nome}" para "${d.nome}"`,
    dados: { de: { nome: antes.nome, descricao: antes.descricao }, para: d }
  })
  return { ok: true }
})
