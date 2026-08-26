import { eq } from 'drizzle-orm'
import { useDb, batches } from '../../../../db'
import { iniciarLote } from '../../../../utils/sender'
import { smtpConfig } from '../../../../utils/mailer'
import { checarBaseUrl } from '../../../../utils/urls'

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  if (!smtpConfig().enabled) {
    throw createError({ statusCode: 400, statusMessage: 'SMTP desabilitado (NUXT_SMTP_ENABLED=false)' })
  }
  const aviso = checarBaseUrl()

  // Registrado ANTES de iniciar: se o disparo falhar, ainda se sabe quem tentou.
  const operador = event.context.operador
  if (operador) {
    await useDb()
      .update(batches)
      .set({ disparadoPorUserId: operador.id, disparadoPorNome: operador.nome })
      .where(eq(batches.id, id))
  }

  return { ...(await iniciarLote(id)), aviso }
})
