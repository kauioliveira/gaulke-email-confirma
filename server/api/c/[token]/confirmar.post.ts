import { and, eq } from 'drizzle-orm'
import { useDb, recipients, batches } from '../../../db'
import { registrarEventoDoRequest } from '../../../utils/tracking'
import { foraDaLixeira } from '../../../utils/lotes'
import { emitirWebhook } from '../../../utils/webhooks'

/** Confirmacao explicita de leitura — esta e a prova real, com IP e horario. */
export default defineEventHandler(async event => {
  const token = getRouterParam(event, 'token') || ''
  const r = (
    await useDb()
      .select({
        id: recipients.id,
        confirmedAt: recipients.confirmedAt,
        email: recipients.email,
        nome: recipients.nome,
        empresa: recipients.empresa,
        documento: recipients.documento,
        codigo: recipients.codigo,
        loteId: batches.id,
        loteNome: batches.nome
      })
      .from(recipients)
      .innerJoin(batches, eq(batches.id, recipients.batchId))
      .where(and(eq(recipients.token, token), foraDaLixeira))
  )[0]

  if (!r) throw createError({ statusCode: 404, statusMessage: 'Link invalido ou expirado' })

  // idempotente: reconfirmar nao sobrescreve o primeiro aceite
  if (r.confirmedAt) return { ok: true, confirmadoEm: r.confirmedAt, jaConfirmado: true }

  await registrarEventoDoRequest(event, r.id, 'confirmacao', { aceite: 'Li e estou ciente' })
  const atualizado = (
    await useDb()
      .select({ confirmedAt: recipients.confirmedAt })
      .from(recipients)
      .where(eq(recipients.id, r.id))
  )[0]

  await emitirWebhook(
    'comunicado.confirmado',
    {
      destinatarioId: r.id,
      codigo: r.codigo,
      destinatario: { nome: r.nome, email: r.email, empresa: r.empresa, documento: r.documento },
      lote: { id: r.loteId, nome: r.loteNome },
      confirmadoEm: atualizado?.confirmedAt ?? null
    },
    `/admin/destinatario/${r.id}`
  )
  return { ok: true, confirmadoEm: atualizado?.confirmedAt, jaConfirmado: false }
})
