import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm'
import { useDb, auditoria } from '../../db'
import { exigirPapel } from '../../utils/permissoes'

/**
 * Trilha de auditoria, paginada e filtrada no servidor. Supervisor e admin.
 *
 * `entidade` + `entidadeId` permitem abrir "o historico deste lote" a partir
 * de outras telas; `busca` procura no resumo e no nome de quem fez.
 */
export default defineEventHandler(async event => {
  exigirPapel(event, 'supervisor', 'consultar a auditoria')
  const q = getQuery(event)

  const busca = String(q.busca || '').trim()
  const acao = String(q.acao || '').trim()
  const entidade = String(q.entidade || '').trim()
  const entidadeId = String(q.entidadeId || '').trim()
  const de = String(q.de || '').trim()
  const ate = String(q.ate || '').trim()
  const pagina = Math.max(1, Number(q.pagina || 1))
  const porPagina = Math.min(200, Math.max(10, Number(q.porPagina || 50)))

  const cond: SQL[] = []
  if (acao) cond.push(eq(auditoria.acao, acao))
  if (entidade) cond.push(eq(auditoria.entidade, entidade))
  if (entidadeId) cond.push(eq(auditoria.entidadeId, entidadeId))
  if (busca) {
    cond.push(or(ilike(auditoria.resumo, `%${busca}%`), ilike(auditoria.userNome, `%${busca}%`))!)
  }
  // as datas do filtro sao dias de Sao Paulo, nao do fuso do servidor
  if (/^\d{4}-\d{2}-\d{2}$/.test(de)) cond.push(gte(auditoria.quando, new Date(`${de}T00:00:00${DESLOCAMENTO_SP}`)))
  if (/^\d{4}-\d{2}-\d{2}$/.test(ate)) cond.push(lte(auditoria.quando, new Date(`${ate}T23:59:59.999${DESLOCAMENTO_SP}`)))

  const where = cond.length ? and(...cond) : undefined
  const db = useDb()

  const [contagem, registros, acoes] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(auditoria).where(where),
    db
      .select()
      .from(auditoria)
      .where(where)
      .orderBy(desc(auditoria.quando), desc(auditoria.id))
      .limit(porPagina)
      .offset((pagina - 1) * porPagina),
    db.selectDistinct({ acao: auditoria.acao }).from(auditoria).orderBy(auditoria.acao)
  ])

  return {
    registros,
    total: contagem[0]?.n ?? 0,
    pagina,
    porPagina,
    acoes: acoes.map(a => a.acao)
  }
})
