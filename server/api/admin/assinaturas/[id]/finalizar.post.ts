import { operadorAtual } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { carregarAssinatura, finalizarDocumento, codigoAssinatura } from '../../../../utils/assinatura'

/** "Gerar de novo": todos assinaram, mas o PDF final falhou (certificado vencido, por exemplo). */
export default defineEventHandler(async event => {
  operadorAtual(event)
  const d = await carregarAssinatura(Number(getRouterParam(event, 'id')))
  if (d.status !== 'aguardando' || !d.finalizacaoErro) throw createError({ statusCode: 409, statusMessage: 'Não há PDF final pendente.' })
  const r = await finalizarDocumento(d.id)
  await auditar(event, 'assinatura.finalizar', { entidade: 'assinatura', id: d.id, resumo: `Gerou de novo o PDF final de ${codigoAssinatura(d.id)}${r.ok ? '' : ` — falhou: ${r.erro}`}` })
  if (!r.ok) throw createError({ statusCode: 500, statusMessage: r.erro })
  return { ok: true }
})
