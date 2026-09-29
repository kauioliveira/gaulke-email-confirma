import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, solicitacoes } from '../../../../db'
import { operadorAtual } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { suprimidos } from '../../../../utils/supressao'
import { carregarSolicitacao, enviarEmailSolic, registrarEventoSolic } from '../../../../utils/solicitacoes'

const schema = z.object({
  /** e-mail corrigido; vazio = o mesmo */
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(320).nullish()
})

/**
 * Reenvia o pedido (o cliente diz que nao recebeu). O link continua o MESMO:
 * o que ele ja enviou por ele segue valendo. Com e-mail corrigido, o antigo
 * fica no historico e na auditoria.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const s = await carregarSolicitacao(Number(getRouterParam(event, 'id')))
  const d = validar(schema, await readBody(event))
  if (s.status === 'cancelada') throw createError({ statusCode: 409, statusMessage: 'A solicitação foi cancelada.' })

  const novo = d.email && d.email !== s.destinatarioEmail ? d.email : null
  if ((await suprimidos([novo ?? s.destinatarioEmail])).length) {
    throw createError({
      statusCode: 400,
      statusMessage: novo
        ? 'Este e-mail devolveu antes e está bloqueado.'
        : 'Este e-mail devolveu antes e está bloqueado. Informe um e-mail corrigido.'
    })
  }
  if (novo) {
    await useDb().update(solicitacoes).set({ destinatarioEmail: novo }).where(eq(solicitacoes.id, s.id))
    await registrarEventoSolic(s.id, 'email_corrigido', `E-mail corrigido de ${s.destinatarioEmail} para ${novo}`, { porNome: op.nome })
  }

  const r = await enviarEmailSolic(s.id, 'pedido', { porNome: op.nome })
  await auditar(event, 'solicitacao.reenviar', {
    entidade: 'solicitacao',
    id: s.id,
    resumo: `Reenviou o pedido "${s.titulo}" para ${novo ?? s.destinatarioEmail}${novo ? ` (antes ${s.destinatarioEmail})` : ''}${r.ok ? '' : ' — FALHOU'}`,
    dados: { emailAnterior: novo ? s.destinatarioEmail : null, ok: r.ok, erro: r.erro ?? null }
  })
  if (!r.ok) throw createError({ statusCode: 502, statusMessage: `O e-mail não saiu: ${r.erro}` })
  return { ok: true }
})
