import { asc, eq, sql } from 'drizzle-orm'
import { useDb, checklists, checklistItens } from '../../../db'
import type { ModeloChecklist } from '../../../../shared/types/api'

/** Modelos de checklist, com os itens. `todos=1` inclui os arquivados. */
export default defineEventHandler(async event => {
  const todos = getQuery(event).todos === '1'
  const db = useDb()
  const modelos = await db
    .select({
      m: checklists,
      usos: sql<number>`(select count(*)::int from sys_mail_solic s where s.checklist_id = sys_mail_checklists.id)`
    })
    .from(checklists)
    .where(todos ? undefined : eq(checklists.ativo, true))
    .orderBy(asc(checklists.setor), asc(checklists.nome))
  const itens = await db.select().from(checklistItens).orderBy(asc(checklistItens.ordem), asc(checklistItens.id))

  return modelos.map(({ m, usos }): ModeloChecklist => ({
    id: m.id,
    nome: m.nome,
    descricao: m.descricao,
    setor: m.setor,
    ativo: m.ativo,
    criadoPorNome: m.criadoPorNome,
    atualizadoPorNome: m.atualizadoPorNome,
    updatedAt: m.updatedAt.toISOString(),
    usos,
    itens: itens
      .filter(i => i.checklistId === m.id)
      .map(i => ({
        titulo: i.titulo,
        instrucao: i.instrucao,
        obrigatorio: i.obrigatorio,
        tipos: i.tipos,
        maxArquivos: i.maxArquivos,
        modeloPath: i.modeloPath,
        modeloNome: i.modeloNome
      }))
  }))
})
