import { writeFile } from 'node:fs/promises'
import { garantirStorage, nomeSeguro, caminhoNoStorage } from '../../utils/storage'
import { falhar } from '../../utils/erro'

const MAX_BYTES = 25 * 1024 * 1024

/** Upload do PDF do lote para o diretorio privado storage/files. */
export default defineEventHandler(async event => {
  let partes: Awaited<ReturnType<typeof readMultipartFormData>>
  try {
    partes = await readMultipartFormData(event)
  } catch (err) {
    throw falhar(event, 'recebimento do PDF', err)
  }
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

  // gravacao no volume: e aqui que producao difere do dev (dono e permissao
  // do /app/storage/files dentro do container)
  const nome = nomeSeguro(arquivo.filename!)
  try {
    const dir = await garantirStorage()
    await writeFile(caminhoNoStorage(nome), arquivo.data)
    console.info(`[gaulke-mail] PDF gravado: ${dir}/${nome} (${arquivo.data.length} bytes)`)
  } catch (err) {
    throw falhar(event, 'gravacao do PDF no storage', err)
  }

  return { ok: true, nome, nomeOriginal: arquivo.filename, tamanho: arquivo.data.length }
})
