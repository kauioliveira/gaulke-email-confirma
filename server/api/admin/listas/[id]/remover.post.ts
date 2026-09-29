import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { useDb, listas, listaMembros } from '../../../../db'
import { operadorAtual } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { carregarLista } from '../../../../utils/listas'

const schema = z.object({ ids: z.array(z.number().int()).min(1).max(20000) })

/** Tira contatos da lista. */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const l = await carregarLista(Number(getRouterParam(event, 'id')))
  const { ids } = validar(schema, await readBody(event))
  const fora = await useDb()
    .delete(listaMembros)
    .where(and(eq(listaMembros.listaId, l.id), inArray(listaMembros.id, ids)))
    .returning({ email: listaMembros.email })
  await useDb().update(listas).set({ atualizadoEm: new Date(), atualizadoPorNome: op.nome }).where(eq(listas.id, l.id))
  await auditar(event, 'lista.remover', {
    entidade: 'lista',
    id: l.id,
    resumo: `Tirou ${fora.length} contato(s) da lista "${l.nome}"`,
    dados: { emails: fora.map(f => f.email).slice(0, 200) }
  })
  return { removidos: fora.length }
})
