import { writeFile } from 'node:fs/promises'
import { garantirStorage, nomeSeguro, caminhoNoStorage } from '../../utils/storage'
import { TIPOS_ANEXO, tipoPelaExtensao, assinaturaConfere, rotulosDe } from '../../../shared/types/tipos-arquivo'
import { falhar } from '../../utils/erro'
import { auditar } from '../../utils/auditoria'

const MAX_BYTES = 25 * 1024 * 1024

/**
 * Upload do anexo do lote para o diretorio privado storage/files.
 *
 * Aceitava so PDF. Passou a aceitar tambem planilha, documento, CSV e os
 * demais formatos de shared/types/tipos-arquivo.ts — o que muda e o TIPO, nao
 * o caminho: o arquivo continua fora de public/ e so sai por /c/<token>, com
 * registro de download.
 */
export default defineEventHandler(async event => {
  let partes: Awaited<ReturnType<typeof readMultipartFormData>>
  try {
    partes = await readMultipartFormData(event)
  } catch (err) {
    throw falhar(event, 'recebimento do arquivo', err)
  }
  const arquivo = partes?.find(p => p.name === 'arquivo' && p.filename)
  if (!arquivo) throw createError({ statusCode: 400, statusMessage: 'Nenhum arquivo enviado' })

  if (arquivo.data.length > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Arquivo maior que 25 MB' })
  }
  const tipo = tipoPelaExtensao(arquivo.filename!)
  if (!tipo) {
    throw createError({
      statusCode: 400,
      statusMessage: `Formato nao aceito. Envie um destes: ${rotulosDe(TIPOS_ANEXO)}`
    })
  }
  /**
   * Confere a ASSINATURA do formato, nao so a extensao — renomear um .exe para
   * .pdf e trivial, e o arquivo sai daqui para clientes.
   *
   * CSV e TXT sao a excecao declarada no mapa: texto puro nao tem magic bytes,
   * entao para eles valem a extensao e o tamanho.
   */
  if (!assinaturaConfere(arquivo.data, tipo)) {
    throw createError({
      statusCode: 400,
      statusMessage: `O arquivo nao parece ser um ${tipo.rotulo} valido`
    })
  }

  // gravacao no volume: e aqui que producao difere do dev (dono e permissao
  // do /app/storage/files dentro do container)
  const nome = nomeSeguro(arquivo.filename!)
  try {
    const dir = await garantirStorage()
    await writeFile(caminhoNoStorage(nome), arquivo.data)
    console.info(`[gaulke-mail] anexo gravado: ${dir}/${nome} (${arquivo.data.length} bytes, ${tipo.rotulo})`)
  } catch (err) {
    throw falhar(event, 'gravacao do anexo no storage', err)
  }

  await auditar(event, 'arquivo.enviar', {
    entidade: 'arquivo',
    id: nome,
    resumo: `Enviou o anexo "${arquivo.filename}" (${tipo.rotulo}, ${(arquivo.data.length / 1024).toFixed(0)} KB)`,
    dados: { nome, original: arquivo.filename, bytes: arquivo.data.length, tipo: tipo.rotulo }
  })

  return { ok: true, nome, nomeOriginal: arquivo.filename, tamanho: arquivo.data.length }
})
