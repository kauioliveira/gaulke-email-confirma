import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm'
import { useDb, batches } from '../../../db'
import { lotesEmExecucao } from '../../../utils/sender'

/**
 * Lista de lotes com busca, filtro e ordenacao no SERVIDOR.
 *
 * Filtrar no cliente exigiria trazer todos os lotes a cada carregamento — e o
 * numero deles so cresce. Aqui a consulta ja volta pronta e paginada.
 */

/**
 * `nulls last` importa: um lote nunca disparado tem started_at nulo, e no
 * Postgres NULL vem primeiro na ordem decrescente. Sem isso, ordenar por
 * "data de disparo" colocaria justamente os que nunca dispararam no topo.
 */
const ORDENS: Record<string, SQL> = {
  recentes: sql`${batches.createdAt} desc`,
  antigos: sql`${batches.createdAt} asc`,
  nome: sql`${batches.nome} asc`,
  disparo: sql`${batches.startedAt} desc nulls last`,
  conclusao: sql`${batches.finishedAt} desc nulls last`,
  enviados: sql`${batches.enviados} desc`,
  falhas: sql`${batches.falhas} desc`,
  destinatarios: sql`${batches.total} desc`
}

export default defineEventHandler(async event => {
  const q = getQuery(event)

  const busca = String(q.busca || '').trim()
  const status = String(q.status || '').trim()
  const ordem = String(q.ordem || 'recentes')
  const de = String(q.de || '').trim()
  const ate = String(q.ate || '').trim()
  const pagina = Math.max(1, Number(q.pagina || 1))
  const porPagina = Math.min(100, Math.max(5, Number(q.porPagina || 20)))

  const cond: SQL[] = []
  if (status) cond.push(eq(batches.status, status))

  if (busca) {
    // o assunto e o nome do arquivo entram na busca porque quase sempre e por
    // eles que a pessoa lembra do lote, e nao pelo nome que deu na criacao
    cond.push(
      or(
        ilike(batches.nome, `%${busca}%`),
        ilike(batches.assuntoSnapshot, `%${busca}%`),
        ilike(batches.arquivoNome, `%${busca}%`)
      )!
    )
  }

  if (de) cond.push(gte(batches.createdAt, new Date(`${de}T00:00:00`)))
  if (ate) cond.push(lte(batches.createdAt, new Date(`${ate}T23:59:59`)))

  const where = cond.length ? and(...cond) : undefined
  const db = useDb()

  const total =
    (await db.select({ n: sql<number>`count(*)::int` }).from(batches).where(where))[0]?.n ?? 0

  const lista = await db
    .select()
    .from(batches)
    .where(where)
    .orderBy(ORDENS[ordem] ?? ORDENS.recentes!, desc(batches.id))
    .limit(porPagina)
    .offset((pagina - 1) * porPagina)

  // contagem por status, para os atalhos de filtro mostrarem quantos existem
  const porStatus = await db
    .select({ status: batches.status, n: sql<number>`count(*)::int` })
    .from(batches)
    .groupBy(batches.status)

  const ativos = new Set(lotesEmExecucao())

  return {
    lotes: lista.map(l => ({ ...l, workerAtivo: ativos.has(l.id) })),
    total,
    pagina,
    porPagina,
    contagemPorStatus: Object.fromEntries(porStatus.map(s => [s.status, s.n])) as Record<string, number>
  }
})
