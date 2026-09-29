import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { useDb, solicitacoes } from '../../../db'
import { operadorAtual } from '../../../utils/permissoes'
import { CONTAGENS_SOLIC, resumoDaLinha } from '../../../utils/solicitacoes'

/**
 * Lista das solicitacoes. Filtros:
 *   status   aberta | em_analise | concluida | cancelada | atrasada | analisar
 *   minhas=1 so as que eu pedi
 *   busca    cliente, e-mail, empresa, CPF/CNPJ, titulo ou SOL-26-X7K2P9
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const q = getQuery(event)
  const status = String(q.status || '')
  const busca = String(q.busca || '').trim()
  const pagina = Math.max(1, Number(q.pagina) || 1)
  const porPagina = 50

  const cond: SQL[] = []
  if (status === 'atrasada') {
    cond.push(eq(solicitacoes.status, 'aberta'), sql`${solicitacoes.prazo} < (now() at time zone 'America/Sao_Paulo')::date`)
  } else if (status === 'analisar') {
    cond.push(
      sql`exists (select 1 from sys_mail_solic_itens i where i.solic_id = ${solicitacoes.id}
                   and (i.status = 'enviado' or (i.status = 'nao_possui' and i.analisado_em is null)))`,
      sql`${solicitacoes.status} in ('aberta', 'em_analise')`
    )
  } else if (['aberta', 'em_analise', 'concluida', 'cancelada'].includes(status)) {
    cond.push(eq(solicitacoes.status, status))
  } else {
    // padrao: o que esta em andamento
    cond.push(sql`${solicitacoes.status} in ('aberta', 'em_analise')`)
  }
  if (q.minhas === '1' && op.id) cond.push(eq(solicitacoes.criadoPorUserId, op.id))
  if (busca) {
    const digitos = busca.replace(/\D/g, '')
    cond.push(
      or(
        ilike(solicitacoes.destinatarioEmail, `%${busca}%`),
        ilike(solicitacoes.destinatarioNome, `%${busca}%`),
        ilike(solicitacoes.empresa, `%${busca}%`),
        ilike(solicitacoes.titulo, `%${busca}%`),
        ...(digitos.length >= 4 ? [ilike(solicitacoes.documento, `%${digitos}%`)] : []),
        ilike(solicitacoes.codigo, `%${busca}%`)
      )!
    )
  }

  const onde = and(...cond)
  const db = useDb()
  const linhas = await db
    .select({ s: solicitacoes, c: CONTAGENS_SOLIC })
    .from(solicitacoes)
    .where(onde)
    .orderBy(desc(solicitacoes.createdAt), desc(solicitacoes.id))
    .limit(porPagina)
    .offset((pagina - 1) * porPagina)
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(solicitacoes)
    .where(onde)

  // contadores das abas, sempre do universo inteiro (respeitando "minhas")
  const minhas = q.minhas === '1' && op.id ? sql`and criado_por_user_id = ${op.id}` : sql``
  const [contadores] = await db.execute<{ aberta: number; em_analise: number; atrasada: number; analisar: number }>(sql`
    select
      count(*) filter (where status = 'aberta')::int as aberta,
      count(*) filter (where status = 'em_analise')::int as em_analise,
      count(*) filter (where status = 'aberta' and prazo < (now() at time zone 'America/Sao_Paulo')::date)::int as atrasada,
      count(*) filter (where status in ('aberta', 'em_analise') and exists (
        select 1 from sys_mail_solic_itens i where i.solic_id = s.id
           and (i.status = 'enviado' or (i.status = 'nao_possui' and i.analisado_em is null))))::int as analisar
    from sys_mail_solic s where true ${minhas}`)

  return {
    solicitacoes: linhas.map(l => resumoDaLinha(l.s, l.c as never)),
    total,
    pagina,
    porPagina,
    contadores: contadores ?? { aberta: 0, em_analise: 0, atrasada: 0, analisar: 0 }
  }
})
