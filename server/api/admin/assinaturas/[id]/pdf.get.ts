import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { auditar } from '../../../../utils/auditoria'
import { caminhoDocumento, disposicao, slugPasta } from '../../../../utils/documentos'
import { carregarAssinatura, codigoAssinatura } from '../../../../utils/assinatura'

/** PDF original ou final (assinado). `?inline=1` abre no navegador. */
export default defineEventHandler(async event => {
  const d = await carregarAssinatura(Number(getRouterParam(event, 'id')))
  const q = getQuery(event)
  const final = q.versao === 'final'
  const caminho = final ? d.finalPath : d.originalPath
  if (!caminho) throw createError({ statusCode: 404, statusMessage: final ? 'O documento ainda não foi assinado por todos' : 'Original não encontrado' })
  const abs = caminhoDocumento(caminho)
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) throw createError({ statusCode: 404, statusMessage: 'Arquivo indisponível no servidor' })
  await auditar(event, 'assinatura.baixar', { entidade: 'assinatura', id: d.id, resumo: `Baixou o PDF ${final ? 'assinado' : 'original'} de ${codigoAssinatura(d)}` })
  setResponseHeaders(event, {
    'content-type': 'application/pdf',
    'content-length': info.size,
    'content-disposition': disposicao(`${codigoAssinatura(d)}_${slugPasta(d.titulo, 50)}${final ? '_assinado' : ''}.pdf`, q.inline === '1'),
    'cache-control': 'no-store, private'
  })
  return sendStream(event, createReadStream(abs))
})
