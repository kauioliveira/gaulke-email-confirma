import { eq } from 'drizzle-orm'
import { useDb, checklists } from '../../../db'
import { operadorAtual } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'
import { checklistSchema, gravarItensChecklist, setorDoModelo } from '../../../utils/checklists'

/**
 * Edita um modelo. As solicitacoes ja criadas a partir dele NAO mudam: cada
 * uma guardou a sua copia dos itens, porque o cliente ja recebeu aquela lista.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const id = Number(getRouterParam(event, 'id'))
  const d = validar(checklistSchema, await readBody(event))
  const db = useDb()
  const [antes] = await db.select().from(checklists).where(eq(checklists.id, id))
  if (!antes) throw createError({ statusCode: 404, statusMessage: 'Modelo não encontrado' })

  const setor = d.departamentoId === undefined ? { departamentoId: antes.departamentoId, setor: antes.setor } : await setorDoModelo(op, d.departamentoId)
  await db
    .update(checklists)
    .set({ nome: d.nome, descricao: d.descricao, ...setor, atualizadoPorNome: op.nome, updatedAt: new Date() })
    .where(eq(checklists.id, id))
  await gravarItensChecklist(id, d.itens)
  await auditar(event, 'checklist.editar', {
    entidade: 'checklist',
    id,
    resumo: `Editou o modelo de checklist "${d.nome}"`,
    dados: { antes: { nome: antes.nome, setor: antes.setor }, depois: { nome: d.nome, setor: setor.setor, itens: d.itens.map(i => i.titulo) } }
  })
  return { ok: true }
})
