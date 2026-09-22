import { writeFile } from 'node:fs/promises'
import { garantirImagens, nomeSeguro, caminhoNaImagem } from '../../utils/storage'
import { TIPOS_IMAGEM, tipoPelaExtensao, assinaturaConfere, rotulosDe } from '../../../shared/types/tipos-arquivo'
import { falhar } from '../../utils/erro'

/**
 * Upload de uma imagem do computador para o corpo do e-mail.
 *
 * Separado do upload de anexos (upload.post.ts) porque o destino e outro: a
 * imagem vai para um diretorio PUBLICO, servido por /img/ sem token, enquanto
 * o anexo so sai por /c/<token>/arquivo, com registro de download.
 */

// 5 MB. Imagem de e-mail acima disso nao e necessidade, e a maioria dos
// clientes de e-mail nem carrega — o limite e para proteger quem recebe.
const MAX_BYTES = 5 * 1024 * 1024

export default defineEventHandler(async event => {
  let partes: Awaited<ReturnType<typeof readMultipartFormData>>
  try {
    partes = await readMultipartFormData(event)
  } catch (err) {
    throw falhar(event, 'recebimento da imagem', err)
  }
  const arquivo = partes?.find(p => p.name === 'arquivo' && p.filename)
  if (!arquivo) throw createError({ statusCode: 400, statusMessage: 'Nenhuma imagem enviada' })

  if (arquivo.data.length > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Imagem maior que 5 MB' })
  }

  const tipo = tipoPelaExtensao(arquivo.filename!, TIPOS_IMAGEM)
  if (!tipo) {
    throw createError({
      statusCode: 400,
      statusMessage: `Formato de imagem nao aceito. Use: ${rotulosDe(TIPOS_IMAGEM)}`
    })
  }
  // a extensao nao prova nada: confere os magic bytes do formato
  if (!assinaturaConfere(arquivo.data, tipo)) {
    throw createError({
      statusCode: 400,
      statusMessage: `O arquivo nao parece ser um ${tipo.rotulo} valido`
    })
  }

  const nome = nomeSeguro(arquivo.filename!)
  try {
    const dir = await garantirImagens()
    await writeFile(caminhoNaImagem(nome), arquivo.data)
    console.info(`[gaulke-mail] imagem gravada: ${dir}/${nome} (${arquivo.data.length} bytes)`)
  } catch (err) {
    throw falhar(event, 'gravacao da imagem no storage', err)
  }

  // `caminho` e o que o bloco de imagem guarda e o que vira o src no e-mail
  return {
    ok: true,
    nome,
    caminho: `img/${nome}`,
    nomeOriginal: arquivo.filename,
    tamanho: arquivo.data.length
  }
})
