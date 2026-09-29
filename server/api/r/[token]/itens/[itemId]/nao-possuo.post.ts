import { clientIp } from '../../../../../utils/request'
import { solicitacaoDoToken, itemDoToken, marcarNaoPossui } from '../../../../../utils/solicitacoes'

export default defineEventHandler(async event => {
  const s = await solicitacaoDoToken(getRouterParam(event, 'token') || '')
  const item = await itemDoToken(s, Number(getRouterParam(event, 'itemId')))
  const corpo = await readBody<{ justificativa?: unknown }>(event)
  await marcarNaoPossui(s, item, typeof corpo?.justificativa === 'string' ? corpo.justificativa : '', clientIp(event))
  return { ok: true }
})
