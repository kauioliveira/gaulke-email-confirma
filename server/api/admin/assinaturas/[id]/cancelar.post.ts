import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, assinDocumentos } from '../../../../db'
import { operadorAtual, temPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { carregarAssinatura, registrarEventoAssin, codigoAssinatura } from '../../../../utils/assinatura'

const schema = z.object({ motivo: z.string().trim().min(3, 'Informe o motivo').max(500) })

/** Cancela: os links passam a mostrar "cancelado". Quem enviou ou supervisor/admin. */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const d = await carregarAssinatura(Number(getRouterParam(event, 'id')))
  const { motivo } = validar(schema, await readBody(event))
  if (d.status !== 'aguardando') throw createError({ statusCode: 409, statusMessage: 'Só dá para cancelar um documento que aguarda assinaturas.' })
  if (d.criadoPorUserId !== op.id && !temPapel(op, 'supervisor')) {
    throw createError({ statusCode: 403, statusMessage: 'Só quem enviou, supervisores e administradores cancelam.' })
  }
  await useDb().update(assinDocumentos).set({ status: 'cancelado', canceladoEm: new Date(), canceladoPorNome: op.nome, canceladoMotivo: motivo }).where(eq(assinDocumentos.id, d.id))
  await registrarEventoAssin(d.id, 'cancelado', `Cancelado por ${op.nome}: ${motivo}`, { porNome: op.nome })
  await auditar(event, 'assinatura.cancelar', { entidade: 'assinatura', id: d.id, resumo: `Cancelou ${codigoAssinatura(d.id)} "${d.titulo}": ${motivo}` })
  return { ok: true }
})
