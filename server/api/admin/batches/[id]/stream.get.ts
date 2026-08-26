import { useBatchBus, type BatchEvent } from '../../../../utils/sse'

/**
 * SSE: fluxo unidirecional servidor -> UI. Escolhido no lugar de WebSocket
 * porque o navegador reconecta sozinho e nao exige upgrade no proxy.
 */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Lote invalido' })
  }

  // impede o Nginx de bufferizar e segurar os eventos.
  // os demais cabecalhos sao definidos pelo proprio createEventStream.
  setResponseHeader(event, 'x-accel-buffering', 'no')

  const stream = createEventStream(event)
  const bus = useBatchBus()

  let fechado = false
  let ping: ReturnType<typeof setInterval> | undefined
  const encerrar = () => {
    if (fechado) return
    fechado = true
    clearInterval(ping)
    bus.off(`batch:${id}`, ouvinte)
  }

  /**
   * Quando o operador fecha a aba, o stream morre antes de onClosed rodar.
   * Sem este guarda, o push seguinte estoura como unhandledRejection
   * ("WritableStream is closed") e polui o log do servidor.
   */
  const enviar = (dados: unknown) => {
    if (fechado) return
    stream.push(JSON.stringify(dados)).catch(encerrar)
  }

  const ouvinte = (payload: BatchEvent) => enviar(payload)
  bus.on(`batch:${id}`, ouvinte)

  // heartbeat: mantem a conexao viva atraves de proxies com timeout curto
  ping = setInterval(() => {
    enviar({ batchId: id, tipo: 'ping', at: new Date().toISOString() })
  }, 25000)

  stream.onClosed(async () => {
    encerrar()
    await stream.close().catch(() => {})
  })

  // O push so pode acontecer DEPOIS de send(): aguardar um push antes disso
  // trava o handler e os cabecalhos nunca chegam ao navegador.
  queueMicrotask(() => {
    enviar({ batchId: id, tipo: 'conectado', at: new Date().toISOString() })
  })

  return stream.send()
})
