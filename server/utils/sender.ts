import { eq, sql, and } from 'drizzle-orm'
import { useDb, useSql, batches, recipients, type Recipient, type Batch } from '../db'
import { enviarEmail } from './mailer'
import { renderizar, renderizarAssunto, versaoTexto } from './render'
import { registrarEvento } from './tracking'
import { useBatchBus } from './sse'

const MAX_TENTATIVAS = 3
/** Item preso em "enviando" por mais que isso volta para a fila (processo caiu no meio). */
const LOCK_EXPIRA_MS = 5 * 60 * 1000

type Worker = { batchId: number; parar: boolean }
const workers = new Map<number, Worker>()

export function loteEmExecucao(batchId: number) {
  return workers.has(batchId)
}

export function lotesEmExecucao() {
  return [...workers.keys()]
}

function dormir(ms: number, worker: Worker) {
  // acorda a cada 250ms para responder rapido a um "pausar"
  return new Promise<void>(resolve => {
    const fim = Date.now() + ms
    const tick = () => {
      if (worker.parar || Date.now() >= fim) return resolve()
      setTimeout(tick, Math.min(250, fim - Date.now()))
    }
    tick()
  })
}

/**
 * Pega o proximo destinatario pendente travando a linha no banco.
 * FOR UPDATE SKIP LOCKED garante que duas instancias do app nunca
 * enviem o mesmo e-mail duas vezes.
 */
async function reivindicarProximo(batchId: number): Promise<Recipient | null> {
  const sqlc = useSql()
  const linhas = await sqlc<Recipient[]>`
    update sys_mail_recipients r
       set status = 'enviando', locked_at = now()
     where r.id = (
       select id from sys_mail_recipients
        where batch_id = ${batchId} and status = 'pendente'
        order by id
        for update skip locked
        limit 1
     )
    returning r.*
  `
  const row = linhas[0]
  if (!row) return null
  // postgres.js devolve snake_case; normalizamos o que o worker usa
  return normalizar(row)
}

function normalizar(row: any): Recipient {
  return {
    ...row,
    batchId: row.batch_id ?? row.batchId,
    dadosExtras: row.dados_extras ?? row.dadosExtras,
    ultimoErro: row.ultimo_erro ?? row.ultimoErro,
    messageId: row.message_id ?? row.messageId,
    downloadCount: row.download_count ?? row.downloadCount
  }
}

/** Devolve para a fila itens travados por um processo que morreu. */
export async function destravarOrfaos(batchId?: number) {
  const db = useDb()
  const cond = batchId
    ? and(eq(recipients.status, 'enviando'), eq(recipients.batchId, batchId))
    : eq(recipients.status, 'enviando')
  const r = await db
    .update(recipients)
    .set({ status: 'pendente', lockedAt: null })
    // o corte e calculado no proprio Postgres: evita divergencia de relogio
    // entre o servidor da aplicacao e o do banco
    .where(and(cond, sql`${recipients.lockedAt} < now() - make_interval(secs => ${LOCK_EXPIRA_MS / 1000})`))
    .returning({ id: recipients.id })
  return r.length
}

async function enviarUm(lote: Batch, r: Recipient) {
  const vars = {
    nome: r.nome,
    email: r.email,
    empresa: r.empresa,
    codigo: r.codigo,
    token: r.token,
    dadosExtras: (r.dadosExtras as Record<string, unknown>) || null
  }
  const html = renderizar(lote.htmlSnapshot, vars)
  const assunto = renderizarAssunto(lote.assuntoSnapshot, vars)
  const texto = versaoTexto(vars, assunto)

  return enviarEmail({
    para: r.email,
    assunto,
    html,
    texto,
    // permite rastrear a mensagem no log do servidor SMTP
    headers: { 'X-Gaulke-Codigo': r.codigo, 'X-Gaulke-Lote': String(lote.id) },
    pedirRecibo: lote.pedirRecibo === 'true'
  })
}

async function processarLote(worker: Worker) {
  const db = useDb()
  const bus = useBatchBus()
  const batchId = worker.batchId

  try {
    while (!worker.parar) {
      const lote = (await db.select().from(batches).where(eq(batches.id, batchId)))[0]
      if (!lote || lote.status !== 'enviando') break

      const r = await reivindicarProximo(batchId)
      if (!r) {
        // acabou a fila
        await db
          .update(batches)
          .set({ status: 'concluido', finishedAt: new Date() })
          .where(eq(batches.id, batchId))
        bus.emitBatch({ batchId, tipo: 'concluido', mensagem: 'Lote concluido' })
        break
      }

      try {
        const info = await enviarUm(lote, r)
        await db
          .update(recipients)
          .set({
            status: 'enviado',
            sentAt: new Date(),
            messageId: info.messageId,
            lockedAt: null,
            ultimoErro: null,
            tentativas: r.tentativas + 1
          })
          .where(eq(recipients.id, r.id))
        await registrarEvento(r.id, 'enviado', { meta: { messageId: info.messageId } })

        const [c] = await db
          .update(batches)
          .set({ enviados: sql`${batches.enviados} + 1` })
          .where(eq(batches.id, batchId))
          .returning({ enviados: batches.enviados, falhas: batches.falhas, total: batches.total })

        bus.emitBatch({
          batchId,
          tipo: 'enviado',
          recipientId: r.id,
          email: r.email,
          codigo: r.codigo,
          status: 'enviado',
          mensagem: info.response,
          ...c
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const tentativas = r.tentativas + 1
        const desistiu = tentativas >= MAX_TENTATIVAS
        await db
          .update(recipients)
          .set({
            status: desistiu ? 'erro' : 'pendente',
            tentativas,
            ultimoErro: msg.slice(0, 1000),
            lockedAt: null
          })
          .where(eq(recipients.id, r.id))
        await registrarEvento(r.id, 'erro', { meta: { erro: msg, tentativa: tentativas } })

        let contagem = {}
        if (desistiu) {
          const [c] = await db
            .update(batches)
            .set({ falhas: sql`${batches.falhas} + 1` })
            .where(eq(batches.id, batchId))
            .returning({ enviados: batches.enviados, falhas: batches.falhas, total: batches.total })
          contagem = c || {}
        }
        bus.emitBatch({
          batchId,
          tipo: 'erro',
          recipientId: r.id,
          email: r.email,
          codigo: r.codigo,
          status: desistiu ? 'erro' : 'pendente',
          mensagem: desistiu ? msg : `${msg} (tentativa ${tentativas}, sera repetido)`,
          ...contagem
        })
      }

      if (worker.parar) break
      await dormir(lote.intervaloMs, worker)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await useDb().update(batches).set({ status: 'erro' }).where(eq(batches.id, batchId))
    useBatchBus().emitBatch({ batchId, tipo: 'erro', mensagem: `Lote interrompido: ${msg}` })
  } finally {
    workers.delete(batchId)
  }
}

export async function iniciarLote(batchId: number) {
  if (workers.has(batchId)) return { ok: true, jaRodando: true }

  const db = useDb()
  const lote = (await db.select().from(batches).where(eq(batches.id, batchId)))[0]
  if (!lote) throw createError({ statusCode: 404, statusMessage: 'Lote nao encontrado' })

  await destravarOrfaos(batchId)

  // o que decide e a fila, nao o rotulo: um lote 'concluido' pode ter
  // recebido falhas reenfileiradas e precisa poder voltar a rodar
  const pendentes =
    (
      await db
        .select({ pendentes: sql<number>`count(*)::int` })
        .from(recipients)
        .where(and(eq(recipients.batchId, batchId), eq(recipients.status, 'pendente')))
    )[0]?.pendentes ?? 0

  if (!pendentes) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nao ha destinatarios pendentes neste lote'
    })
  }
  await db
    .update(batches)
    .set({ status: 'enviando', startedAt: lote.startedAt ?? new Date(), finishedAt: null })
    .where(eq(batches.id, batchId))

  const worker: Worker = { batchId, parar: false }
  workers.set(batchId, worker)
  useBatchBus().emitBatch({ batchId, tipo: 'iniciado', mensagem: 'Disparo iniciado' })
  // roda em background: a request HTTP nao espera o lote inteiro
  void processarLote(worker)
  return { ok: true, jaRodando: false }
}

export async function pausarLote(batchId: number) {
  const worker = workers.get(batchId)
  if (worker) worker.parar = true
  await useDb().update(batches).set({ status: 'pausado' }).where(eq(batches.id, batchId))
  // o item em voo termina de ser enviado; nada e perdido
  await destravarOrfaos(batchId)
  useBatchBus().emitBatch({ batchId, tipo: 'pausado', mensagem: 'Disparo pausado' })
  return { ok: true }
}

/** Recoloca na fila quem falhou definitivamente. */
export async function reenviarFalhas(batchId: number) {
  const db = useDb()
  const r = await db
    .update(recipients)
    .set({ status: 'pendente', tentativas: 0, lockedAt: null })
    .where(and(eq(recipients.batchId, batchId), eq(recipients.status, 'erro')))
    .returning({ id: recipients.id })
  if (r.length) {
    const lote = (await db.select().from(batches).where(eq(batches.id, batchId)))[0]
    await db
      .update(batches)
      .set({
        falhas: sql`greatest(${batches.falhas} - ${r.length}, 0)`,
        // reabre o lote: sem isso o disparo ficaria travado em 'concluido'
        status: lote?.status === 'concluido' ? 'pausado' : lote?.status,
        finishedAt: null
      })
      .where(eq(batches.id, batchId))
  }
  return { ok: true, reenfileirados: r.length }
}
