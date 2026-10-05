import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { carregarMensagem } from '../../../../utils/caixa/mensagem'
import { caminhoDocumento, disposicao, slugPasta } from '../../../../utils/documentos'
import { auditar } from '../../../../utils/auditoria'

/** O e-mail original (.eml): abre no Outlook/Thunderbird do jeito que chegou. */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const { m } = await carregarMensagem(event, id)
  if (!m.pasta) throw createError({ statusCode: 404, statusMessage: 'O e-mail original não foi guardado' })
  const abs = caminhoDocumento(`${m.pasta}/mensagem.eml`)
  if (!(await stat(abs).catch(() => null))?.isFile()) throw createError({ statusCode: 404, statusMessage: 'O e-mail original não foi guardado' })
  await auditar(event, 'caixa.baixar_eml', { entidade: 'inbound', id, resumo: `Baixou o e-mail de ${m.de ?? '—'} (${m.assunto ?? 'sem assunto'})` })
  setResponseHeaders(event, {
    'content-type': 'message/rfc822',
    'content-disposition': disposicao(`${slugPasta(m.assunto || 'email', 60)}.eml`),
    'cache-control': 'no-store, private'
  })
  return sendStream(event, createReadStream(abs))
})
