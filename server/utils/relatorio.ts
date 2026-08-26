import { and, eq, or, ilike, gte, lte, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import { recipients, batches } from '../db'

export type FiltrosRelatorio = {
  batchId?: number
  status?: string
  marco?: string
  busca?: string
  de?: string
  ate?: string
}

export function lerFiltros(q: Record<string, unknown>): FiltrosRelatorio {
  return {
    batchId: q.batchId ? Number(q.batchId) : undefined,
    status: q.status ? String(q.status) : undefined,
    marco: q.marco ? String(q.marco) : undefined,
    busca: q.busca ? String(q.busca).trim() : undefined,
    de: q.de ? String(q.de) : undefined,
    ate: q.ate ? String(q.ate) : undefined
  }
}

/** Traduz os filtros da tela em condicoes SQL. */
export function montarWhere(f: FiltrosRelatorio) {
  const cond: SQL[] = []
  if (f.batchId) cond.push(eq(recipients.batchId, f.batchId))
  if (f.status) cond.push(eq(recipients.status, f.status))

  if (f.busca) {
    cond.push(
      or(
        ilike(recipients.email, `%${f.busca}%`),
        ilike(recipients.nome, `%${f.busca}%`),
        ilike(recipients.empresa, `%${f.busca}%`),
        ilike(recipients.codigo, `%${f.busca}%`)
      )!
    )
  }

  const marcos: Record<string, SQL> = {
    abriu: isNotNull(recipients.firstOpenAt),
    'abriu-pessoa': isNotNull(recipients.firstHumanOpenAt),
    'abriu-so-maquina': and(
      isNotNull(recipients.firstOpenAt),
      isNull(recipients.firstHumanOpenAt)
    )!,
    acessou: isNotNull(recipients.firstAccessAt),
    confirmou: isNotNull(recipients.confirmedAt),
    baixou: isNotNull(recipients.firstDownloadAt),
    'nao-acessou': isNull(recipients.firstAccessAt),
    'nao-confirmou': isNull(recipients.confirmedAt),
    'nao-baixou': isNull(recipients.firstDownloadAt)
  }
  if (f.marco && marcos[f.marco]) cond.push(marcos[f.marco]!)

  if (f.de) cond.push(gte(recipients.createdAt, new Date(`${f.de}T00:00:00`)))
  if (f.ate) cond.push(lte(recipients.createdAt, new Date(`${f.ate}T23:59:59`)))

  return cond.length ? and(...cond) : undefined
}

export const colunasRelatorio = {
  id: recipients.id,
  batchId: recipients.batchId,
  loteNome: batches.nome,
  loteDisparadoPor: batches.disparadoPorNome,
  nome: recipients.nome,
  email: recipients.email,
  empresa: recipients.empresa,
  codigo: recipients.codigo,
  token: recipients.token,
  status: recipients.status,
  tentativas: recipients.tentativas,
  ultimoErro: recipients.ultimoErro,
  sentAt: recipients.sentAt,
  firstOpenAt: recipients.firstOpenAt,
  firstHumanOpenAt: recipients.firstHumanOpenAt,
  lastOpenAt: recipients.lastOpenAt,
  openCount: recipients.openCount,
  firstAccessAt: recipients.firstAccessAt,
  confirmedAt: recipients.confirmedAt,
  firstDownloadAt: recipients.firstDownloadAt,
  downloadCount: recipients.downloadCount,
  createdAt: recipients.createdAt
}

/** Ultimo IP conhecido do destinatario, para a coluna resumida da tabela. */
export const ultimoIp = sql<string | null>`(
  select e.ip from sys_mail_events e
   where e.recipient_id = ${recipients.id} and e.ip is not null
   order by e.created_at desc limit 1
)`
