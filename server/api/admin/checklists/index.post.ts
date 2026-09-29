import { operadorAtual } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'
import { checklistSchema, criarChecklist } from '../../../utils/checklists'

/** Novo modelo de checklist. Qualquer usuario cria: e so um ponto de partida. */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const d = validar(checklistSchema, await readBody(event))
  const m = await criarChecklist(d, op)
  await auditar(event, 'checklist.criar', {
    entidade: 'checklist',
    id: m.id,
    resumo: `Criou o modelo de checklist "${m.nome}" (${d.itens.length} itens)`,
    dados: { nome: m.nome, setor: m.setor, itens: d.itens.map(i => i.titulo) }
  })
  return { id: m.id }
})
