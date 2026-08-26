import { EventEmitter } from 'node:events'

export type BatchEvent = {
  batchId: number
  tipo: string
  recipientId?: number
  email?: string
  codigo?: string
  status?: string
  mensagem?: string
  enviados?: number
  falhas?: number
  total?: number
  at: string
}

/** Barramento em memoria que alimenta o console em tempo real (SSE). */
class BatchBus extends EventEmitter {
  emitBatch(e: Omit<BatchEvent, 'at'>) {
    const payload: BatchEvent = { ...e, at: new Date().toISOString() }
    this.emit(`batch:${e.batchId}`, payload)
    this.emit('batch:*', payload)
  }
}

const bus = new BatchBus()
bus.setMaxListeners(200)

export function useBatchBus() {
  return bus
}
