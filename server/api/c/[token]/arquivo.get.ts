import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { useDb, recipients, batches } from '../../../db'
import { registrarEventoDoRequest } from '../../../utils/tracking'
import { caminhoNoStorage } from '../../../utils/storage'

/**
 * Download rastreado. O PDF fica FORA de public/ justamente para que a
 * unica forma de baixa-lo seja passando por aqui, com token e registro.
 */
export default defineEventHandler(async event => {
  const token = getRouterParam(event, 'token') || ''

  const linha = (
    await useDb()
      .select({
        id: recipients.id,
        confirmedAt: recipients.confirmedAt,
        arquivoPath: batches.arquivoPath,
        arquivoNome: batches.arquivoNome,
        exigirConfirmacao: batches.exigirConfirmacao
      })
      .from(recipients)
      .innerJoin(batches, eq(batches.id, recipients.batchId))
      .where(eq(recipients.token, token))
  )[0]

  if (!linha) throw createError({ statusCode: 404, statusMessage: 'Link invalido ou expirado' })
  if (!linha.arquivoPath) {
    throw createError({ statusCode: 404, statusMessage: 'Nenhum arquivo vinculado a este envio' })
  }
  if (linha.exigirConfirmacao === 'true' && !linha.confirmedAt) {
    throw createError({ statusCode: 403, statusMessage: 'Confirme a leitura antes de baixar' })
  }

  const caminho = caminhoNoStorage(linha.arquivoPath)
  const info = await stat(caminho).catch(() => null)
  if (!info?.isFile()) {
    throw createError({ statusCode: 404, statusMessage: 'Arquivo indisponivel no servidor' })
  }

  await registrarEventoDoRequest(event, linha.id, 'download', { arquivo: linha.arquivoNome })

  const nomeExibido = (linha.arquivoNome || 'documento.pdf').replace(/["\\]/g, '')
  setResponseHeaders(event, {
    'content-type': 'application/pdf',
    'content-length': info.size,
    'content-disposition': `attachment; filename="${nomeExibido}"`,
    'cache-control': 'no-store, private'
  })
  return sendStream(event, createReadStream(caminho))
})
