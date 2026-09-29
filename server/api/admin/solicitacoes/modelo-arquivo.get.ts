import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { caminhoDocumento, disposicao } from '../../../utils/documentos'
import { mimeDoArquivo } from '../../../../shared/types/tipos-arquivo'

/** Baixa um arquivo modelo (para conferir antes de mandar). */
export default defineEventHandler(async event => {
  const q = getQuery(event)
  const path = String(q.path || '')
  if (!/^modelos\/[A-Za-z0-9._-]+$/.test(path)) throw createError({ statusCode: 400, statusMessage: 'Arquivo inválido' })
  const abs = caminhoDocumento(path)
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) throw createError({ statusCode: 404, statusMessage: 'Arquivo não encontrado' })
  const nome = String(q.nome || path.slice(8))
  setResponseHeaders(event, {
    'content-type': mimeDoArquivo(nome),
    'content-length': info.size,
    'content-disposition': disposicao(nome),
    'cache-control': 'no-store, private'
  })
  return sendStream(event, createReadStream(abs))
})
