import { eq } from 'drizzle-orm'
import { useDb, assinSignatarios } from '../../../db'
import { clientContext } from '../../../utils/request'
import { signatarioDoToken, landingAssinatura, registrarEventoAssin } from '../../../utils/assinatura'

/** Dados da pagina de quem assina. O primeiro acesso entra no historico. */
export default defineEventHandler(async event => {
  const { doc, sig } = await signatarioDoToken(getRouterParam(event, 'token') || '')
  if (!sig.visualizadoEm && doc.status === 'aguardando') {
    const ctx = clientContext(event)
    await useDb().update(assinSignatarios).set({ visualizadoEm: new Date() }).where(eq(assinSignatarios.id, sig.id))
    await registrarEventoAssin(doc.id, 'visualizado', `${sig.nome} abriu o documento pela primeira vez`, { signatarioId: sig.id, ip: ctx.ip, userAgent: ctx.userAgent })
  }
  setResponseHeader(event, 'cache-control', 'no-store, private')
  return landingAssinatura(doc, sig)
})
