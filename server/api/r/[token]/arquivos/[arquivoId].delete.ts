import { clientIp } from '../../../../utils/request'
import { solicitacaoDoToken, removerArquivoDoCliente } from '../../../../utils/solicitacoes'

export default defineEventHandler(async event => {
  const s = await solicitacaoDoToken(getRouterParam(event, 'token') || '')
  await removerArquivoDoCliente(s, Number(getRouterParam(event, 'arquivoId')), clientIp(event))
  return { ok: true }
})
