import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, assinSignatarios } from '../../../../../../db'
import { operadorAtual } from '../../../../../../utils/permissoes'
import { auditar } from '../../../../../../utils/auditoria'
import { suprimidos } from '../../../../../../utils/supressao'
import { carregarAssinatura, convidar, registrarEventoAssin, codigoAssinatura } from '../../../../../../utils/assinatura'

const schema = z.object({ email: z.string().trim().toLowerCase().email('E-mail inválido').max(320).nullish() })

/** Reenvia o convite (mesmo link), opcionalmente para um e-mail corrigido. */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const d = await carregarAssinatura(Number(getRouterParam(event, 'id')))
  const sid = Number(getRouterParam(event, 'sid'))
  const body = validar(schema, await readBody(event))
  if (d.status !== 'aguardando') throw createError({ statusCode: 409, statusMessage: 'O documento não está aguardando assinaturas.' })
  const db = useDb()
  const [s] = await db.select().from(assinSignatarios).where(and(eq(assinSignatarios.id, sid), eq(assinSignatarios.documentoId, d.id)))
  if (!s) throw createError({ statusCode: 404, statusMessage: 'Signatário não encontrado' })
  if (s.status !== 'aguardando') throw createError({ statusCode: 409, statusMessage: s.status === 'assinado' ? 'Esta pessoa já assinou.' : 'Ainda não é a vez desta pessoa.' })
  const novo = body.email && body.email !== s.email ? body.email : null
  if ((await suprimidos([novo ?? s.email])).length) throw createError({ statusCode: 400, statusMessage: 'Este e-mail devolveu antes e está bloqueado. Informe outro.' })
  if (novo) {
    // e-mail novo invalida qualquer codigo enviado ao antigo
    await db.update(assinSignatarios).set({ email: novo, otpHash: null, otpExpiraEm: null }).where(eq(assinSignatarios.id, s.id))
    await registrarEventoAssin(d.id, 'email_corrigido', `E-mail de ${s.nome} corrigido de ${s.email} para ${novo}`, { signatarioId: s.id, porNome: op.nome })
  }
  const r = await convidar(s.id, 'convite', op.nome)
  await auditar(event, 'assinatura.reenviar', {
    entidade: 'assinatura',
    id: d.id,
    resumo: `Reenviou o convite de ${codigoAssinatura(d)} para ${s.nome} <${novo ?? s.email}>${novo ? ` (antes ${s.email})` : ''}${r.ok ? '' : ' — FALHOU'}`
  })
  if (!r.ok) throw createError({ statusCode: 502, statusMessage: `O e-mail não saiu: ${r.erro}` })
  return { ok: true }
})
