import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { signatarioDoToken } from '../../../utils/assinatura'
import { caminhoDocumento } from '../../../utils/documentos'

/** O PDF ORIGINAL, para quem assina ler antes. Cancelado nao se abre mais. */
export default defineEventHandler(async event => {
  const { doc } = await signatarioDoToken(getRouterParam(event, 'token') || '')
  if (doc.status === 'cancelado' || !doc.originalPath) throw createError({ statusCode: 410, statusMessage: 'Este documento foi cancelado' })
  const abs = caminhoDocumento(doc.originalPath)
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) throw createError({ statusCode: 404, statusMessage: 'Documento indisponível' })
  setResponseHeaders(event, { 'content-type': 'application/pdf', 'content-length': info.size, 'cache-control': 'no-store, private' })
  return sendStream(event, createReadStream(abs))
})
