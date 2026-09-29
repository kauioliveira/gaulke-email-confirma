import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { useDb, inbound, recipients, batches, solicitacoes, assinDocumentos } from '../../db'

/**
 * Caixa de entrada: o que o monitor leu das caixas dos canais.
 *
 * Mensagens SEM VINCULO (que nao se ligam a nenhum envio) aparecem so com
 * remetente e assunto — o corpo nao e guardado.
 */
export default defineEventHandler(async event => {
  const q = getQuery(event)
  const classificacao = String(q.classificacao || '').trim()
  const semVinculo = ['1', 'true', 'sim'].includes(String(q.semVinculo || '').toLowerCase())
  const pagina = Math.max(1, Number(q.pagina || 1))
  const porPagina = Math.min(200, Math.max(10, Number(q.porPagina || 50)))

  const cond: SQL[] = []
  if (classificacao) cond.push(eq(inbound.classificacao, classificacao))
  // sem vinculo = nao liga a lote, nem a solicitacao, nem a assinatura
  const semNada = sql`${inbound.recipientId} is null and ${inbound.solicId} is null and ${inbound.assinDocumentoId} is null`
  if (semVinculo) cond.push(semNada)
  const where = cond.length ? and(...cond) : undefined
  const db = useDb()

  const [contagem, linhas, porTipo] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(inbound).where(where),
    db
      .select({
        id: inbound.id,
        contaNome: inbound.contaNome,
        de: inbound.de,
        assunto: inbound.assunto,
        recebidoEm: inbound.recebidoEm,
        processadoEm: inbound.processadoEm,
        classificacao: inbound.classificacao,
        vinculo: inbound.vinculo,
        trecho: inbound.trecho,
        detalhe: inbound.detalhe,
        recipientId: inbound.recipientId,
        destinatarioEmail: recipients.email,
        destinatarioNome: recipients.nome,
        batchId: inbound.batchId,
        loteNome: batches.nome,
        solicId: inbound.solicId,
        solicTitulo: solicitacoes.titulo,
        solicCodigo: solicitacoes.codigo,
        assinDocumentoId: inbound.assinDocumentoId,
        assinTitulo: assinDocumentos.titulo,
        assinCodigo: assinDocumentos.codigo,
        // chamado aberto no painel a partir desta mensagem
        ticketCode: sql<string | null>`(select t.ticket_code from sys_mail_tickets t where t.inbound_id = sys_mail_inbound.id order by t.id desc limit 1)`,
        ticketStatus: sql<string | null>`(select t.status_envio from sys_mail_tickets t where t.inbound_id = sys_mail_inbound.id order by t.id desc limit 1)`
      })
      .from(inbound)
      .leftJoin(recipients, eq(recipients.id, inbound.recipientId))
      .leftJoin(batches, eq(batches.id, inbound.batchId))
      .leftJoin(solicitacoes, eq(solicitacoes.id, inbound.solicId))
      .leftJoin(assinDocumentos, eq(assinDocumentos.id, inbound.assinDocumentoId))
      .where(where)
      .orderBy(desc(inbound.processadoEm), desc(inbound.id))
      .limit(porPagina)
      .offset((pagina - 1) * porPagina),
    db
      .select({ classificacao: inbound.classificacao, n: sql<number>`count(*)::int`, semVinculo: sql<number>`count(*) filter (where ${semNada})::int` })
      .from(inbound)
      .groupBy(inbound.classificacao)
  ])

  return { mensagens: linhas, total: contagem[0]?.n ?? 0, pagina, porPagina, porTipo }
})
