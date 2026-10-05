import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { carregarMensagem } from '../../../../../utils/caixa/mensagem'
import { caminhoDocumento, disposicao } from '../../../../../utils/documentos'
import { auditar } from '../../../../../utils/auditoria'
import type { AnexoRecebido } from '../../../../../db'

/** Um arquivo que o cliente mandou na resposta. Bloqueado pelo antivirus nao sai. */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const n = Number(getRouterParam(event, 'n'))
  const { m } = await carregarMensagem(event, id)
  const a = ((m.anexos ?? []) as AnexoRecebido[])[n]
  if (!m.pasta || !a) throw createError({ statusCode: 404, statusMessage: 'Anexo não encontrado' })
  if (a.antivirus === 'infectado') throw createError({ statusCode: 410, statusMessage: 'O antivírus bloqueou este arquivo' })
  const abs = caminhoDocumento(`${m.pasta}/${a.arquivo}`)
  if (!(await stat(abs).catch(() => null))?.isFile()) throw createError({ statusCode: 404, statusMessage: 'Arquivo não encontrado no servidor' })
  const verNoNavegador = getQuery(event).ver === '1' && /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i.test(a.tipo)
  await auditar(event, 'caixa.baixar_anexo', { entidade: 'inbound', id, resumo: `Baixou "${a.nome}" da resposta de ${m.de ?? '—'}` })
  setResponseHeaders(event, {
    'content-type': verNoNavegador ? a.tipo : 'application/octet-stream',
    'content-disposition': disposicao(a.nome, verNoNavegador),
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff'
  })
  return sendStream(event, createReadStream(abs))
})
