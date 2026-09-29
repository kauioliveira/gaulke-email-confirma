import { eq } from 'drizzle-orm'
import { useDb, solicitacoes } from '../../../../db'
import { operadorAtual, temPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { carregarSolicitacao, recalcularStatus, registrarEventoSolic } from '../../../../utils/solicitacoes'

/**
 * Reabre uma solicitacao concluida ou cancelada: o link do cliente volta a
 * aceitar envios. Cancelada so volta por quem pediu ou supervisor/admin.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const s = await carregarSolicitacao(Number(getRouterParam(event, 'id')))
  if (s.status !== 'concluida' && s.status !== 'cancelada') {
    throw createError({ statusCode: 409, statusMessage: 'A solicitação não está encerrada.' })
  }
  if (s.status === 'cancelada' && s.criadoPorUserId !== op.id && !temPapel(op, 'supervisor')) {
    throw createError({ statusCode: 403, statusMessage: 'Só quem pediu, supervisores e administradores reabrem uma solicitação cancelada.' })
  }
  await useDb()
    .update(solicitacoes)
    .set({
      status: 'aberta',
      concluidaEm: null,
      concluidaPorNome: null,
      canceladaEm: null,
      canceladaPorNome: null,
      canceladaMotivo: null
    })
    .where(eq(solicitacoes.id, s.id))
  await registrarEventoSolic(s.id, 'reaberta', 'Solicitação reaberta', { porNome: op.nome })
  // Cancelada volta ao estado que os itens dizem. Concluida NAO e recalculada:
  // com tudo aprovado ela concluiria de novo na hora — quem reabre quer mexer
  // (pedir mais um documento, desfazer uma aprovacao), e a proxima mudanca
  // num item recalcula.
  const r = s.status === 'cancelada' ? await recalcularStatus(s.id, op.nome) : { antes: s.status, depois: 'aberta' }
  await auditar(event, 'solicitacao.reabrir', {
    entidade: 'solicitacao',
    id: s.id,
    resumo: `Reabriu "${s.titulo}" de ${s.destinatarioEmail} (estava ${s.status})`,
    dados: { statusAntes: s.status, statusDepois: r.depois }
  })
  return { ok: true }
})
