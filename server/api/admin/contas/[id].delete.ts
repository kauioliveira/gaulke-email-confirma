import { eq, sql } from 'drizzle-orm'
import { useDb, accounts, batches } from '../../../db'

/**
 * Exclui uma conta.
 *
 * Os lotes ja disparados por ela nao sao afetados: conta_id vira nulo (ON
 * DELETE SET NULL) e conta_nome, que e snapshot, continua no relatorio dizendo
 * de onde o e-mail saiu.
 *
 * Recusa se houver lote em andamento ou agendado: cortar as credenciais no meio
 * de um disparo transformaria o lote em uma fileira de falhas.
 */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const db = useDb()

  const [emUso] = await db
    .select({ n: sql<number>`count(*)::int`, nomes: sql<string>`string_agg(${batches.nome}, ', ')` })
    .from(batches)
    .where(sql`${batches.contaId} = ${id} and ${batches.status} in ('enviando', 'pausado', 'agendado')`)

  if (emUso && emUso.n > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `Esta conta esta em uso por ${emUso.n} lote(s) nao finalizado(s): ${emUso.nomes}. Conclua ou cancele antes de excluir.`
    })
  }

  const [removida] = await db.delete(accounts).where(eq(accounts.id, id)).returning({ id: accounts.id })
  if (!removida) throw createError({ statusCode: 404, statusMessage: 'Conta nao encontrada' })

  return { ok: true }
})
