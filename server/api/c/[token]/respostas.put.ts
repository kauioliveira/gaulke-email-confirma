import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { useDb, recipients, batches } from '../../../db'
import { clientContext } from '../../../utils/request'
import { registrarEvento } from '../../../utils/tracking'
import { foraDaLixeira } from '../../../utils/lotes'
import { camposComRespostas, salvarRespostasLote } from '../../../utils/lote-campos'

const corpoSchema = z.object({
  respostas: z.array(z.object({ campoId: z.number().int().positive(), valor: z.unknown() })).min(1).max(30)
})

/**
 * Respostas do cliente aos campos da pagina de download. A pagina manda tudo
 * de uma vez, ao confirmar/baixar. O que nao passou na validacao volta em
 * `erros` (por campo); o resto fica salvo mesmo assim.
 */
export default defineEventHandler(async event => {
  const token = getRouterParam(event, 'token') || ''
  const d = validar(corpoSchema, await readBody(event))
  setResponseHeader(event, 'cache-control', 'no-store, private')

  const [r] = await useDb()
    .select({ id: recipients.id, batchId: recipients.batchId })
    .from(recipients)
    .innerJoin(batches, eq(batches.id, recipients.batchId))
    .where(and(eq(recipients.token, token), foraDaLixeira))
  if (!r) throw createError({ statusCode: 404, statusMessage: 'Link invalido ou expirado' })

  const ctx = clientContext(event)
  const s = await salvarRespostasLote(r.batchId, r.id, d.respostas, { ip: ctx.ip, userAgent: ctx.userAgent })
  if (s.gravadas.length || s.apagadas.length) {
    await registrarEvento(r.id, 'campos', {
      ...ctx,
      meta: { campos: s.gravadas.map(g => ({ campoId: g.campoId, resposta: g.resposta.exibicao })), apagados: s.apagadas }
    })
  }
  return { erros: s.erros, campos: await camposComRespostas(r.batchId, r.id) }
})
