import { carregarMensagem, detalheMensagem, respostasDaMensagem } from '../../../utils/caixa/mensagem'

/** Uma mensagem recebida: corpo inteiro, anexos, a que envio pertence e o que ja foi respondido. */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const l = await carregarMensagem(event, id)
  const { respostas, ticket } = await respostasDaMensagem(id)
  setResponseHeader(event, 'cache-control', 'no-store, private')
  return detalheMensagem(l, respostas, ticket)
})
