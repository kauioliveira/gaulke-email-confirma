import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { TIPOS_ANEXO, tipoPelaExtensao, assinaturaConfere, rotulosDe } from '../../../../shared/types/tipos-arquivo'
import { caminhoDocumento, nomeNaPasta } from '../../../utils/documentos'
import { auditar } from '../../../utils/auditoria'

/**
 * Arquivo MODELO de um item ("baixe, preencha e devolva": ficha cadastral,
 * declaracao). Vai para documentos/modelos e o cliente o baixa pelo link.
 * Mesma conferencia de formato dos anexos.
 */
export default defineEventHandler(async event => {
  const partes = await readMultipartFormData(event)
  const p = partes?.find(x => x.name === 'arquivo' && x.filename)
  if (!p) throw createError({ statusCode: 400, statusMessage: 'Nenhum arquivo enviado' })
  const original = basename(p.filename!)
  const tipo = tipoPelaExtensao(original, TIPOS_ANEXO)
  if (!tipo) throw createError({ statusCode: 415, statusMessage: `Formato não aceito. Use ${rotulosDe(TIPOS_ANEXO)}.` })
  if (p.data.length > 10 * 1024 * 1024) throw createError({ statusCode: 413, statusMessage: 'O modelo passa de 10 MB' })
  if (!assinaturaConfere(p.data, tipo)) {
    throw createError({ statusCode: 415, statusMessage: `O conteúdo não é um ${tipo.rotulo} válido` })
  }

  const path = `modelos/${nomeNaPasta(original)}`
  const abs = caminhoDocumento(path)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, p.data)
  await auditar(event, 'solicitacao.modelo_arquivo', {
    entidade: 'arquivo',
    id: path,
    resumo: `Enviou o arquivo modelo "${original}"`
  })
  return { path, nome: original }
})
