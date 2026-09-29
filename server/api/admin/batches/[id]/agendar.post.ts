import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { useDb, batches, recipients } from '../../../../db'
import { resolverConta } from '../../../../utils/mailer'
import { checarBaseUrl } from '../../../../utils/urls'
import { loteEmExecucao } from '../../../../utils/sender'
import { auditar } from '../../../../utils/auditoria'

const schema = z.object({
  /** ISO 8601 com fuso. `null` cancela o agendamento. */
  agendadoPara: z.string().datetime({ offset: true }).nullable()
})

/** 1 min de folga: o relogio do navegador nao e o mesmo do servidor. */
const FOLGA_MS = 60_000

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const { agendadoPara } = validar(schema, await readBody(event))
  const db = useDb()

  const lote = (await db.select().from(batches).where(eq(batches.id, id)))[0]
  if (!lote || lote.excluidoEm) throw createError({ statusCode: 404, statusMessage: 'Lote nao encontrado' })

  // ---- cancelar ----
  if (agendadoPara === null) {
    if (lote.status !== 'agendado') {
      throw createError({ statusCode: 400, statusMessage: 'Este lote nao esta agendado' })
    }
    const [atualizado] = await db
      .update(batches)
      .set({ status: 'rascunho', agendadoPara: null, agendadoEm: null, observacao: null })
      .where(eq(batches.id, id))
      .returning()
    await auditar(event, 'lote.cancelar_agendamento', {
      entidade: 'lote',
      id,
      resumo: `Cancelou o agendamento do lote "${lote.nome}" (era ${formatarDataHora(lote.agendadoPara)})`
    })
    return { ok: true, lote: atualizado }
  }

  // ---- agendar ----
  if (loteEmExecucao(id) || lote.status === 'enviando') {
    throw createError({ statusCode: 400, statusMessage: 'O lote ja esta disparando' })
  }
  // o canal do lote, e nao o .env (veja start.post.ts)
  const conta = await resolverConta(lote.contaId).catch(e => {
    throw createError({ statusCode: 400, statusMessage: `Canal de saída indisponível: ${e instanceof Error ? e.message : e}` })
  })
  if (!conta.enabled) {
    throw createError({ statusCode: 400, statusMessage: `O canal de saída "${conta.nome}" está desativado` })
  }

  const quando = new Date(agendadoPara)
  if (quando.getTime() < Date.now() - FOLGA_MS) {
    throw createError({ statusCode: 400, statusMessage: 'A data escolhida ja passou' })
  }

  // agendar um lote sem fila deixaria o horario chegar e nada acontecer
  const pendentes =
    (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(recipients)
        .where(and(eq(recipients.batchId, id), eq(recipients.status, 'pendente')))
    )[0]?.n ?? 0

  if (!pendentes) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nao ha destinatarios pendentes neste lote'
    })
  }

  const [atualizado] = await db
    .update(batches)
    .set({
      status: 'agendado',
      agendadoPara: quando,
      agendadoEm: new Date(),
      observacao: null
    })
    .where(eq(batches.id, id))
    .returning()

  await auditar(event, 'lote.agendar', {
    entidade: 'lote',
    id,
    resumo: `Agendou o lote "${lote.nome}" para ${formatarDataHora(quando)}`,
    dados: { de: lote.agendadoPara, para: quando, pendentes }
  })

  // mesmo aviso do disparo manual: link publico invalido quebra o e-mail todo
  return { ok: true, lote: atualizado, pendentes, aviso: checarBaseUrl() }
})
