import { clientContext } from '../../../utils/request'
import { signatarioDoToken, assinar, assinarSchema } from '../../../utils/assinatura'

export default defineEventHandler(async event => {
  const { doc, sig } = await signatarioDoToken(getRouterParam(event, 'token') || '')
  const d = validar(assinarSchema, await readBody(event))
  await assinar(doc, sig, d, clientContext(event))
  return { ok: true }
})
