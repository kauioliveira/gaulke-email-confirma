import { clientContext } from '../../../utils/request'
import { signatarioDoToken, recusar } from '../../../utils/assinatura'

export default defineEventHandler(async event => {
  const { doc, sig } = await signatarioDoToken(getRouterParam(event, 'token') || '')
  const corpo = await readBody<{ motivo?: unknown }>(event)
  await recusar(doc, sig, typeof corpo?.motivo === 'string' ? corpo.motivo : '', clientContext(event))
  return { ok: true }
})
