import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, solicitacoes } from '../../../../db'
import { operadorAtual, temPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { carregarSolicitacao, registrarEventoSolic } from '../../../../utils/solicitacoes'

const schema = z.object({ motivo: z.string().trim().min(3, 'Informe o motivo').max(500) })

/**
 * Cancela: o link do cliente passa a mostrar "solicitacao encerrada" e para
 * de aceitar arquivos. O que ja chegou fica na pasta.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const s = await carregarSolicitacao(Number(getRouterParam(event, 'id')))
  const d = validar(schema, await readBody(event))
  if (s.status === 'cancelada') throw createError({ statusCode: 409, statusMessage: 'A solicitação já está cancelada.' })
  if (s.criadoPorUserId !== op.id && !temPapel(op, 'supervisor')) {
    throw createError({ statusCode: 403, statusMessage: 'Só quem pediu, supervisores e administradores cancelam uma solicitação.' })
  }
  await useDb()
    .update(solicitacoes)
    .set({ status: 'cancelada', canceladaEm: new Date(), canceladaPorNome: op.nome, canceladaMotivo: d.motivo })
    .where(eq(solicitacoes.id, s.id))
  await registrarEventoSolic(s.id, 'cancelada', `Cancelada: ${d.motivo}`, { porNome: op.nome })
  await auditar(event, 'solicitacao.cancelar', {
    entidade: 'solicitacao',
    id: s.id,
    resumo: `Cancelou "${s.titulo}" de ${s.destinatarioEmail}: ${d.motivo}`,
    dados: { statusAntes: s.status }
  })
  return { ok: true }
})
