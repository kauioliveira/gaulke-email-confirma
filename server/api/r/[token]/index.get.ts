import { clientIp } from '../../../utils/request'
import { solicitacaoDoToken, landingSolicitacao, registrarAcessoSolic } from '../../../utils/solicitacoes'

/** Dados da pagina do cliente. Registra o acesso (no maximo um evento por hora). */
export default defineEventHandler(async event => {
  const s = await solicitacaoDoToken(getRouterParam(event, 'token') || '')
  await registrarAcessoSolic(s, clientIp(event))
  setResponseHeader(event, 'cache-control', 'no-store, private')
  return landingSolicitacao(s)
})
