import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { signatarioDoToken, codigoAssinatura } from '../../../utils/assinatura'
import { caminhoDocumento, disposicao, slugPasta } from '../../../utils/documentos'

/** O PDF assinado por todos (com a folha de assinaturas). */
export default defineEventHandler(async event => {
  const { doc } = await signatarioDoToken(getRouterParam(event, 'token') || '')
  if (doc.status !== 'concluido' || !doc.finalPath) throw createError({ statusCode: 404, statusMessage: 'O documento ainda não foi assinado por todos' })
  const abs = caminhoDocumento(doc.finalPath)
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) throw createError({ statusCode: 404, statusMessage: 'Documento indisponível' })
  setResponseHeaders(event, {
    'content-type': 'application/pdf',
    'content-length': info.size,
    'content-disposition': disposicao(`${codigoAssinatura(doc.id)}_${slugPasta(doc.titulo, 50)}_assinado.pdf`),
    'cache-control': 'no-store, private'
  })
  return sendStream(event, createReadStream(abs))
})
