import { basename } from 'node:path'
import { clientContext } from '../../../../../utils/request'
import { solicitacaoDoToken, itemDoToken, receberArquivo } from '../../../../../utils/solicitacoes'

/**
 * Um arquivo do cliente para um item. UM por requisicao, de proposito: o
 * proxy da casa corta corpos acima de 30 MB, e dez fotos de celular juntas
 * passariam disso. A tela manda um de cada vez, com barra de progresso.
 */
export default defineEventHandler(async event => {
  const s = await solicitacaoDoToken(getRouterParam(event, 'token') || '')
  const item = await itemDoToken(s, Number(getRouterParam(event, 'itemId')))
  const partes = await readMultipartFormData(event)
  const p = partes?.find(x => x.name === 'arquivo' && x.filename)
  if (!p) throw createError({ statusCode: 400, statusMessage: 'Nenhum arquivo recebido' })

  const ctx = clientContext(event)
  const r = await receberArquivo({
    solic: s,
    item,
    nome: basename(p.filename!).normalize('NFC'),
    dados: p.data,
    ip: ctx.ip,
    userAgent: ctx.userAgent
  })
  if (r.status === 'infectado') {
    throw createError({
      statusCode: 422,
      statusMessage: 'O antivírus encontrou uma ameaça neste arquivo e ele foi descartado. Confira o arquivo e envie outro.'
    })
  }
  return { status: r.status }
})
