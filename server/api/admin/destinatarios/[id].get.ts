import { eq, asc, sql } from 'drizzle-orm'
import { useDb, recipients, batches, events, envios } from '../../../db'
import { temPapel } from '../../../utils/permissoes'
import { linkAcesso } from '../../../utils/urls'
import { camposComRespostas } from '../../../utils/lote-campos'

/** Ficha individual: todos os eventos com IP, user-agent e horario. */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))

  const linha = (
    await useDb()
      .select({
        destinatario: recipients,
        loteNome: batches.nome,
        loteId: batches.id,
        loteStatus: batches.status,
        loteStartedAt: batches.startedAt,
        loteExcluidoEm: batches.excluidoEm,
        loteContaId: batches.contaId,
        loteContaNome: batches.contaNome,
        loteResponderPara: batches.responderPara,
        // anexo individual: o arquivo desta pessoa; senao o do lote. Colunas
        // qualificadas a mao (as duas tabelas tem arquivo_nome)
        arquivoNome: sql<string | null>`coalesce(sys_mail_recipients.arquivo_nome, sys_mail_batches.arquivo_nome)`,
        assunto: batches.assuntoSnapshot,
        html: batches.htmlSnapshot
      })
      .from(recipients)
      .innerJoin(batches, eq(batches.id, recipients.batchId))
      .where(eq(recipients.id, id))
  )[0]

  if (!linha || (linha.loteExcluidoEm && !temPapel(event.context.operador, 'admin'))) {
    throw createError({ statusCode: 404, statusMessage: 'Destinatario nao encontrado' })
  }

  const timeline = await useDb()
    .select()
    .from(events)
    .where(eq(events.recipientId, id))
    .orderBy(asc(events.createdAt), asc(events.id))

  // cada e-mail que saiu (original + reenvios), para a secao "Envios" e para
  // a tela separar a linha do tempo por envio
  const historico = await useDb()
    .select()
    .from(envios)
    .where(eq(envios.recipientId, id))
    .orderBy(asc(envios.numero))

  return {
    ...linha,
    link: linkAcesso(linha.destinatario.token),
    timeline,
    envios: historico,
    // o que o cliente preencheu na pagina de download (lote com campos)
    campos: await camposComRespostas(linha.loteId, id)
  }
})
