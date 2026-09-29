import { operadorAtual } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { carregarSolicitacao, detalheSolicitacao, enviarEmailSolic } from '../../../../utils/solicitacoes'

/**
 * Manda ao cliente UM e-mail com todos os itens recusados e os motivos.
 * Separado da recusa de proposito: quem analisa 8 itens e recusa 3 manda um
 * aviso so, no fim, e nao tres.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const s = await carregarSolicitacao(Number(getRouterParam(event, 'id')))
  const d = await detalheSolicitacao(s.id)
  if (!d.itens.some(i => i.status === 'recusado')) {
    throw createError({ statusCode: 409, statusMessage: 'Não há item recusado para avisar.' })
  }
  const r = await enviarEmailSolic(s.id, 'pendencias', { porNome: op.nome })
  if (!r.ok) throw createError({ statusCode: 502, statusMessage: `O e-mail não saiu: ${r.erro}` })
  await auditar(event, 'solicitacao.avisar_pendencias', {
    entidade: 'solicitacao',
    id: s.id,
    resumo: `Avisou ${s.destinatarioEmail} das pendências de "${s.titulo}"`,
    dados: { recusados: d.itens.filter(i => i.status === 'recusado').map(i => ({ item: i.titulo, motivo: i.motivo })) }
  })
  return { ok: true }
})
