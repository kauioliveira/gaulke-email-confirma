import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, solicitacoes } from '../../../../db'
import { operadorAtual } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { carregarSolicitacao, enviarEmailSolic, registrarEventoSolic, webhookSolicitacao } from '../../../../utils/solicitacoes'

const schema = z.object({
  observacao: z.string().trim().max(500).nullish(),
  /** manda ao cliente o "recebemos tudo" (padrao: o que a solicitacao diz) */
  avisarCliente: z.boolean().optional()
})

/**
 * Conclusao manual: o que faltava chegou por outro caminho (WhatsApp, em
 * maos) ou nao e mais necessario. Os itens ficam como estao.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const s = await carregarSolicitacao(Number(getRouterParam(event, 'id')))
  const d = validar(schema, await readBody(event))
  if (s.status === 'concluida' || s.status === 'cancelada') {
    throw createError({ statusCode: 409, statusMessage: 'A solicitação já está encerrada.' })
  }
  await useDb()
    .update(solicitacoes)
    .set({ status: 'concluida', concluidaEm: new Date(), concluidaPorNome: op.nome })
    .where(eq(solicitacoes.id, s.id))
  await registrarEventoSolic(s.id, 'concluida', `Concluída manualmente${d.observacao ? `: ${d.observacao}` : ''}`, { porNome: op.nome })
  if (d.avisarCliente ?? s.avisarConclusao) await enviarEmailSolic(s.id, 'concluida', { porNome: op.nome })
  await webhookSolicitacao('solicitacao.concluida', s, { concluidaPor: op.nome, automatica: false, observacao: d.observacao ?? null })
  await auditar(event, 'solicitacao.concluir', {
    entidade: 'solicitacao',
    id: s.id,
    resumo: `Concluiu manualmente "${s.titulo}" de ${s.destinatarioEmail}`,
    dados: { observacao: d.observacao ?? null, statusAntes: s.status }
  })
  return { ok: true }
})
