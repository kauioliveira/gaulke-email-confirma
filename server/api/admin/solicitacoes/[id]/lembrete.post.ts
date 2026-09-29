import { operadorAtual } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { carregarSolicitacao, detalheSolicitacao, enviarEmailSolic } from '../../../../utils/solicitacoes'

/** "Enviar lembrete agora": o mesmo e-mail do lembrete automatico, sob demanda. */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const s = await carregarSolicitacao(Number(getRouterParam(event, 'id')))
  if (s.status !== 'aberta') throw createError({ statusCode: 409, statusMessage: 'Só dá para lembrar uma solicitação que espera o cliente.' })
  const d = await detalheSolicitacao(s.id)
  if (!d.itens.some(i => i.obrigatorio && (i.status === 'pendente' || i.status === 'recusado'))) {
    throw createError({ statusCode: 409, statusMessage: 'Não falta nenhum documento obrigatório do cliente.' })
  }
  const r = await enviarEmailSolic(s.id, 'lembrete', { porNome: op.nome })
  await auditar(event, 'solicitacao.lembrete', {
    entidade: 'solicitacao',
    id: s.id,
    resumo: `Enviou lembrete a ${s.destinatarioEmail} ("${s.titulo}")${r.ok ? '' : ' — FALHOU'}`,
    dados: { ok: r.ok, erro: r.erro ?? null }
  })
  if (!r.ok) throw createError({ statusCode: 502, statusMessage: `O e-mail não saiu: ${r.erro}` })
  return { ok: true }
})
