import { clientContext } from '../../../utils/request'
import { signatarioDoToken, enviarCodigo, mascararEmail } from '../../../utils/assinatura'

/** Envia o codigo de 6 digitos para o e-mail de quem assina. */
export default defineEventHandler(async event => {
  const { doc, sig } = await signatarioDoToken(getRouterParam(event, 'token') || '')
  if (doc.status !== 'aguardando') throw createError({ statusCode: 409, statusMessage: 'Este documento não está mais aguardando assinaturas.' })
  if (sig.status !== 'aguardando') throw createError({ statusCode: 409, statusMessage: sig.status === 'assinado' ? 'Você já assinou.' : 'Ainda não é a sua vez de assinar.' })
  await enviarCodigo(doc, sig, clientContext(event))
  return { ok: true, email: mascararEmail(sig.email) }
})
