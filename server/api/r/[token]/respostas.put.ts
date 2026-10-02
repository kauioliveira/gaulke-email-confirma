import { z } from 'zod'
import { clientContext } from '../../../utils/request'
import { solicitacaoDoToken, salvarRespostas } from '../../../utils/solicitacoes'

const corpoSchema = z.object({
  respostas: z.array(z.object({ itemId: z.number().int().positive(), valor: z.unknown() })).min(1).max(40)
})

/**
 * Respostas do cliente aos itens que nao sao documento (texto, escolha,
 * campos, declaracao). Varias de uma vez: a pagina junta o que mudou e
 * manda depois de uma pausa na digitacao.
 *
 * O que nao passou na validacao volta em `erros` (por item); o resto fica
 * salvo mesmo assim.
 */
export default defineEventHandler(async event => {
  const s = await solicitacaoDoToken(getRouterParam(event, 'token') || '')
  const d = validar(corpoSchema, await readBody(event))
  const ctx = clientContext(event)
  setResponseHeader(event, 'cache-control', 'no-store, private')
  const r = await salvarRespostas(s, d.respostas, { ip: ctx.ip, userAgent: ctx.userAgent })
  return { erros: r.erros, itens: r.landing.itens, status: r.landing.status }
})
