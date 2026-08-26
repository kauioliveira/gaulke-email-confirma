import { eq } from 'drizzle-orm'
import { useDb, recipients } from '../../../db'
import { registrarEventoDoRequest } from '../../../utils/tracking'

/** Confirmacao explicita de leitura — esta e a prova real, com IP e horario. */
export default defineEventHandler(async event => {
  const token = getRouterParam(event, 'token') || ''
  const r = (
    await useDb()
      .select({ id: recipients.id, confirmedAt: recipients.confirmedAt })
      .from(recipients)
      .where(eq(recipients.token, token))
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

  return { ok: true, confirmadoEm: atualizado?.confirmedAt, jaConfirmado: false }
})
