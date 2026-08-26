import { iniciarLote } from '../../../../utils/sender'
import { smtpConfig } from '../../../../utils/mailer'
import { checarBaseUrl } from '../../../../utils/urls'

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  if (!smtpConfig().enabled) {
    throw createError({ statusCode: 400, statusMessage: 'SMTP desabilitado (NUXT_SMTP_ENABLED=false)' })
  }
  const aviso = checarBaseUrl()
  return { ...(await iniciarLote(id)), aviso }
})
