import { clientIp } from '../../../../../utils/request'
import { solicitacaoDoToken, itemDoToken, desfazerNaoPossui } from '../../../../../utils/solicitacoes'

export default defineEventHandler(async event => {
  const s = await solicitacaoDoToken(getRouterParam(event, 'token') || '')
  const item = await itemDoToken(s, Number(getRouterParam(event, 'itemId')))
  await desfazerNaoPossui(s, item, clientIp(event))
  return { ok: true }
})
