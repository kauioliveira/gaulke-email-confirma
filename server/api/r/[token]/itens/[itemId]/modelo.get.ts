import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { solicitacaoDoToken, itemDoToken } from '../../../../../utils/solicitacoes'
import { caminhoDocumento, disposicao } from '../../../../../utils/documentos'
import { mimeDoArquivo } from '../../../../../../shared/types/tipos-arquivo'

/** Arquivo modelo do item (ficha para preencher e devolver). */
export default defineEventHandler(async event => {
  const s = await solicitacaoDoToken(getRouterParam(event, 'token') || '')
  const item = await itemDoToken(s, Number(getRouterParam(event, 'itemId')))
  if (s.status === 'cancelada' || !item.modeloPath) throw createError({ statusCode: 404, statusMessage: 'Este item não tem modelo' })
  const abs = caminhoDocumento(item.modeloPath)
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) throw createError({ statusCode: 404, statusMessage: 'Modelo indisponível' })
  const nome = item.modeloNome || 'modelo'
  setResponseHeaders(event, {
    'content-type': mimeDoArquivo(nome),
    'content-length': info.size,
    'content-disposition': disposicao(nome),
    'cache-control': 'no-store, private'
  })
  return sendStream(event, createReadStream(abs))
})
