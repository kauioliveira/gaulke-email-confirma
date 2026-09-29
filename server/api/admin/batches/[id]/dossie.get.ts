import { operadorAtual } from '../../../../utils/permissoes'
import { dossieLote } from '../../../../utils/dossie'
import { auditar } from '../../../../utils/auditoria'

/** Dossie do lote inteiro, em PDF. Gerar fica na auditoria (LGPD). */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const id = Number(getRouterParam(event, 'id'))
  const r = await dossieLote(id, op)
  await auditar(event, 'dossie.lote', {
    entidade: 'lote',
    id,
    resumo: `Gerou o dossiê do lote "${r.lote.nome}" (${r.total} destinatário(s)) — verificação ${r.codigo}`,
    dados: { codigo: r.codigo }
  })
  setResponseHeaders(event, {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="${r.nomeArquivo}"`,
    'cache-control': 'no-store, private'
  })
  return Buffer.from(r.pdf)
})
