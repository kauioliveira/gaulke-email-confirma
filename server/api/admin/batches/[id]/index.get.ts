import { desc, eq, sql } from 'drizzle-orm'
import { useDb, batches, recipients, accounts, ticketsPainel } from '../../../../db'
import { loteEmExecucao } from '../../../../utils/sender'
import { temPapel } from '../../../../utils/permissoes'

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const lote = (await useDb().select().from(batches).where(eq(batches.id, id)))[0]
  // da lixeira, so o admin enxerga (para decidir se restaura)
  if (!lote || (lote.excluidoEm && !temPapel(event.context.operador, 'admin'))) {
    throw createError({ statusCode: 404, statusMessage: 'Lote nao encontrado' })
  }

  const [contagem] = await useDb()
    .select({
      total: sql<number>`count(*)::int`,
      pendentes: sql<number>`count(*) filter (where ${recipients.status} = 'pendente')::int`,
      enviados: sql<number>`count(*) filter (where ${recipients.status} = 'enviado')::int`,
      erros: sql<number>`count(*) filter (where ${recipients.status} = 'erro')::int`,
      aberturas: sql<number>`count(${recipients.firstOpenAt})::int`,
      aberturasPessoa: sql<number>`count(${recipients.firstHumanOpenAt})::int`,
      aberturasMaquina: sql<number>`count(*) filter (
        where ${recipients.firstOpenAt} is not null
          and ${recipients.firstHumanOpenAt} is null)::int`,
      acessos: sql<number>`count(${recipients.firstAccessAt})::int`,
      confirmacoes: sql<number>`count(${recipients.confirmedAt})::int`,
      downloads: sql<number>`count(${recipients.firstDownloadAt})::int`,
      // alvo do atalho "Reenviar para quem nao confirmou"
      naoConfirmaram: sql<number>`count(*) filter (
        where ${recipients.status} = 'enviado' and ${recipients.confirmedAt} is null
          and ${recipients.reenvioPendente} is null)::int`,
      reenviosNaFila: sql<number>`count(${recipients.reenvioPendente})::int`,
      // o que voltou pela caixa do canal (monitor)
      devolucoes: sql<number>`count(*) filter (where ${recipients.bounceTipo} = 'definitiva')::int`,
      respostas: sql<number>`count(${recipients.respondeuAt})::int`,
      recibos: sql<number>`count(${recipients.reciboAt})::int`,
      lembretes: sql<number>`coalesce(sum(${recipients.lembretesEnviados}), 0)::int`,
      // qualificada a mao: dentro da subconsulta, "id" seria o de sys_mail_envios
      reenviados: sql<number>`count(*) filter (where exists (
        select 1 from sys_mail_envios e where e.recipient_id = sys_mail_recipients.id and e.origem = 'reenvio'))::int`
    })
    .from(recipients)
    .where(eq(recipients.batchId, id))

  // remetente e reply-to do canal, para a confirmacao do disparo dizer por onde sai
  const [canal] = lote.contaId
    ? await useDb()
        .select({ nome: accounts.nome, remetente: accounts.remetente, responderPara: accounts.responderPara, ativa: accounts.ativa })
        .from(accounts)
        .where(eq(accounts.id, lote.contaId))
    : []

  // chamados abertos no painel a partir deste lote
  const chamados = await useDb()
    .select({
      motivo: ticketsPainel.motivo,
      ticketCode: ticketsPainel.ticketCode,
      statusEnvio: ticketsPainel.statusEnvio,
      erro: ticketsPainel.erro,
      recipientId: ticketsPainel.recipientId,
      criadoEm: ticketsPainel.criadoEm
    })
    .from(ticketsPainel)
    .where(eq(ticketsPainel.batchId, id))
    .orderBy(desc(ticketsPainel.id))
    .limit(50)

  return {
    lote: { ...lote, workerAtivo: loteEmExecucao(id) },
    contagem,
    chamados,
    canal: canal ? { ...canal, ativa: canal.ativa === 'true' } : null
  }
})
