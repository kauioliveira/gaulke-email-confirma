import { writeFile } from 'node:fs/promises'
import { garantirStorage, nomeSeguro, caminhoNoStorage } from '../../utils/storage'

const MAX_BYTES = 25 * 1024 * 1024

/** Upload do PDF do lote para o diretorio privado storage/files. */
export default defineEventHandler(async event => {
  const partes = await readMultipartFormData(event)
  const arquivo = partes?.find(p => p.name === 'arquivo' && p.filename)
  if (!arquivo) throw createError({ statusCode: 400, statusMessage: 'Nenhum arquivo enviado' })

  if (arquivo.data.length > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Arquivo maior que 25 MB' })
  }
  if (!/\.pdf$/i.test(arquivo.filename!)) {
    throw createError({ statusCode: 400, statusMessage: 'Envie um arquivo PDF' })
  }
  // confere a assinatura do PDF, nao so a extensao
  if (arquivo.data.subarray(0, 4).toString('latin1') !== '%PDF') {
    throw createError({ statusCode: 400, statusMessage: 'O arquivo nao parece ser um PDF valido' })
  }

  await garantirStorage()
  const nome = nomeSeguro(arquivo.filename!)
  await writeFile(caminhoNoStorage(nome), arquivo.data)

  return { ok: true, nome, nomeOriginal: arquivo.filename, tamanho: arquivo.data.length }
})
