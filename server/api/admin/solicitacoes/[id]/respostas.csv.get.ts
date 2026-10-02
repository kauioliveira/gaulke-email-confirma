import { asc, eq, inArray } from 'drizzle-orm'
import { useDb, solicitacoes, solicItens } from '../../../../db'
import { auditar } from '../../../../utils/auditoria'
import { carregarSolicitacao } from '../../../../utils/solicitacoes'
import { codigoSolicitacao, disposicao, slugPasta } from '../../../../utils/documentos'
import { csvDaSolicitacao, csvDoGrupo } from '../../../../utils/respostas-csv'

/**
 * Respostas em CSV. Sem parametro: esta solicitacao, um item por linha.
 * `?grupo=1`: todos os clientes do mesmo envio, um por linha, um item por
 * coluna — para comparar as respostas.
 */
export default defineEventHandler(async event => {
  const s = await carregarSolicitacao(Number(getRouterParam(event, 'id')))
  const doGrupo = !!getQuery(event).grupo && !!s.grupo
  const db = useDb()
  const codigo = codigoSolicitacao(s)
  let csv: string
  let nome: string

  if (doGrupo) {
    const lista = await db.select().from(solicitacoes).where(eq(solicitacoes.grupo, s.grupo!)).orderBy(asc(solicitacoes.id))
    const itens = await db
      .select()
      .from(solicItens)
      .where(inArray(solicItens.solicId, lista.map(x => x.id)))
      .orderBy(asc(solicItens.ordem))
    csv = csvDoGrupo(lista.map(x => ({ s: x, itens: itens.filter(i => i.solicId === x.id) })))
    nome = `respostas_${slugPasta(s.titulo, 40)}_${lista.length}-clientes.csv`
  } else {
    const itens = await db.select().from(solicItens).where(eq(solicItens.solicId, s.id)).orderBy(asc(solicItens.ordem))
    csv = csvDaSolicitacao(s, itens)
    nome = `${codigo}_respostas_${slugPasta(s.empresa || s.destinatarioNome || s.destinatarioEmail, 40)}.csv`
  }

  await auditar(event, 'solicitacao.baixar_respostas', {
    entidade: 'solicitacao',
    id: s.id,
    resumo: doGrupo ? `Baixou as respostas do envio de "${s.titulo}" (todos os clientes)` : `Baixou as respostas da ${codigo} (${s.destinatarioEmail})`
  })
  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': disposicao(nome),
    'cache-control': 'no-store, private'
  })
  return csv
})
