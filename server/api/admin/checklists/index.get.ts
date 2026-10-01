import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import { useDb, checklists, checklistItens } from '../../../db'
import type { ModeloChecklist } from '../../../../shared/types/api'
import { operadorAtual, setorVisivel } from '../../../utils/permissoes'

/**
 * Modelos de checklist, com os itens. `todos=1` inclui os arquivados.
 * Fora o admin, aparecem os do proprio setor e os de todos os setores.
 */
export default defineEventHandler(async event => {
  const todos = getQuery(event).todos === '1'
  const setor = setorVisivel(operadorAtual(event))
  const db = useDb()
  const modelos = await db
    .select({
      m: checklists,
      usos: sql<number>`(select count(*)::int from sys_mail_solic s where s.checklist_id = sys_mail_checklists.id)`,
      nomeSetor: sql<string | null>`(select d.name from public.department d where d.id = sys_mail_checklists.departamento_id)`
    })
    .from(checklists)
    .where(
      and(
        todos ? undefined : eq(checklists.ativo, true),
        setor === undefined ? undefined : or(isNull(checklists.departamentoId), sql`${checklists.departamentoId} is not distinct from ${setor}`)
      )
    )
    .orderBy(asc(checklists.setor), asc(checklists.nome))
  const itens = await db.select().from(checklistItens).orderBy(asc(checklistItens.ordem), asc(checklistItens.id))

  return modelos.map(({ m, usos, nomeSetor }): ModeloChecklist => ({
    id: m.id,
    nome: m.nome,
    descricao: m.descricao,
    setor: nomeSetor,
    departamentoId: m.departamentoId,
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
