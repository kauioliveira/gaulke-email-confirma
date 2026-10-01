import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { useDb, assinDocumentos, assinSignatarios } from '../../../db'
import { operadorAtual, filtroSetor } from '../../../utils/permissoes'
import { resumoAssinatura } from '../../../utils/assinatura'

/**
 * Lista: status (aguardando por padrao), "so as minhas" e busca (titulo, ASS-…, quem assina).
 * Fora o admin, cada um ve so as do proprio setor (filtroSetor).
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const q = getQuery(event)
  const status = String(q.status || 'aguardando')
  const busca = String(q.busca || '').trim()
  const doSetor = filtroSetor(op, assinDocumentos.departamentoId)
  const cond: SQL[] = doSetor ? [doSetor] : []
  if (status !== 'todos') cond.push(eq(assinDocumentos.status, status))
  if (q.minhas === '1' && op.id) cond.push(eq(assinDocumentos.criadoPorUserId, op.id))
  if (busca) {
    cond.push(
      or(
        ilike(assinDocumentos.titulo, `%${busca}%`),
        ilike(assinDocumentos.codigo, `%${busca}%`),
        ilike(assinDocumentos.clienteDocumento, `%${busca.replace(/\D/g, '') || busca}%`),
        ilike(assinDocumentos.clienteNome, `%${busca}%`),
        sql`exists (select 1 from sys_mail_assin_signatarios s where s.documento_id = ${assinDocumentos.id}
                     and (s.nome ilike ${`%${busca}%`} or s.email ilike ${`%${busca}%`}))`,
      )!
    )
  }
  const db = useDb()
  const docs = await db.select().from(assinDocumentos).where(cond.length ? and(...cond) : undefined).orderBy(desc(assinDocumentos.createdAt)).limit(200)
  const sigs = docs.length ? await db.select().from(assinSignatarios).where(inArray(assinSignatarios.documentoId, docs.map(d => d.id))) : []
  const [cont] = await db.execute<{ aguardando: number; concluido: number; recusado: number }>(sql`
    select count(*) filter (where status = 'aguardando')::int as aguardando,
           count(*) filter (where status = 'concluido')::int as concluido,
           count(*) filter (where status = 'recusado')::int as recusado
      from sys_mail_assin_documentos
     where true
       ${q.minhas === '1' && op.id ? sql`and criado_por_user_id = ${op.id}` : sql``}
       ${doSetor ? sql`and ${doSetor}` : sql``}`)
  return {
    documentos: docs.map(d => resumoAssinatura(d, sigs.filter(s => s.documentoId === d.id).sort((a, b) => a.ordem - b.ordem))),
    contadores: cont ?? { aguardando: 0, concluido: 0, recusado: 0 }
  }
})
