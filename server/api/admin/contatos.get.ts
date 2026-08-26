import { and, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import { useDb, recipients, batches } from '../../db'

/**
 * Contatos ja conhecidos, para reaproveitar em um novo envio.
 *
 * Uma pessoa pode ter recebido varios lotes, entao usamos DISTINCT ON (email)
 * ficando com o registro MAIS RECENTE dela — e dele que saem o nome, a empresa
 * e os marcos mostrados na tela.
 *
 * Os filtros de comportamento existem para o caso mais comum de retrabalho:
 * "reenviar para quem ainda nao confirmou a leitura".
 */
export default defineEventHandler(async event => {
  const q = getQuery(event)
  const busca = String(q.busca || '').trim()
  const batchId = q.batchId ? Number(q.batchId) : undefined
  const marco = String(q.marco || '').trim()
  const limite = Math.min(5000, Math.max(1, Number(q.limite || 2000)))

  const cond: SQL[] = []
  if (batchId) cond.push(eq(recipients.batchId, batchId))
  if (busca) {
    cond.push(
      or(
        ilike(recipients.email, `%${busca}%`),
        ilike(recipients.nome, `%${busca}%`),
        ilike(recipients.empresa, `%${busca}%`)
      )!
    )
  }

  const marcos: Record<string, SQL> = {
    confirmou: isNotNull(recipients.confirmedAt),
    'nao-confirmou': isNull(recipients.confirmedAt),
    acessou: isNotNull(recipients.firstAccessAt),
    'nao-acessou': isNull(recipients.firstAccessAt),
    baixou: isNotNull(recipients.firstDownloadAt),
    'nao-baixou': isNull(recipients.firstDownloadAt),
    erro: eq(recipients.status, 'erro')
  }
  if (marco && marcos[marco]) cond.push(marcos[marco]!)

  const db = useDb()
  const contatos = await db
    .selectDistinctOn([recipients.email], {
      email: recipients.email,
      nome: recipients.nome,
      empresa: recipients.empresa,
      loteNome: batches.nome,
      loteId: batches.id,
      sentAt: recipients.sentAt,
      confirmedAt: recipients.confirmedAt,
      firstDownloadAt: recipients.firstDownloadAt,
      status: recipients.status
    })
    .from(recipients)
    .innerJoin(batches, eq(batches.id, recipients.batchId))
    .where(cond.length ? and(...cond) : undefined)
    // o DISTINCT ON exige que a 1a coluna do ORDER BY seja a da distincao;
    // o id decrescente e o que garante "o envio mais recente desta pessoa"
    .orderBy(recipients.email, desc(recipients.id))
    .limit(limite)

  const totalGeral =
    (
      await db
        .select({ total: sql<number>`count(distinct ${recipients.email})::int` })
        .from(recipients)
    )[0]?.total ?? 0

  return {
    contatos: contatos.sort((a, b) =>
      (a.nome || a.email).localeCompare(b.nome || b.email, 'pt-BR')
    ),
    total: contatos.length,
    totalGeral
  }
})
