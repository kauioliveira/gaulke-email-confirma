import { operadorAtual } from '../../../../utils/permissoes'
import { dossieDestinatario } from '../../../../utils/dossie'
import { auditar } from '../../../../utils/auditoria'

/** Dossie de comprovacao do destinatario, em PDF. Gerar fica na auditoria (LGPD). */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const id = Number(getRouterParam(event, 'id'))
  const r = await dossieDestinatario(id, op)
  await auditar(event, 'dossie.destinatario', {
    entidade: 'destinatario',
    id,
    resumo: `Gerou o dossiê de comprovação de ${r.destinatario.email} (${r.destinatario.codigo}) — verificação ${r.codigo}`,
    dados: { loteId: r.lote.id, codigo: r.codigo }
  })
  setResponseHeaders(event, {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="${r.nomeArquivo}"`,
    'cache-control': 'no-store, private'
  })
  return Buffer.from(r.pdf)
})
