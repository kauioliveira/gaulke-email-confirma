import { eq, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDb, events, recipients } from '../db'
import { clientContext } from './request'
import { classificarAbertura } from './abertura'
// TipoEvento vem de shared/types/api.ts — declarar aqui duplicaria o tipo
import type { TipoEvento } from '../../shared/types/api'

/**
 * `sys_mail_events` e append-only: nunca editamos um evento ja gravado.
 * As colunas *_at em recipients sao apenas desnormalizacao para o relatorio.
 */
export async function registrarEvento(
  recipientId: number,
  tipo: TipoEvento,
  ctx: { ip?: string | null; userAgent?: string | null; referer?: string | null; meta?: unknown } = {}
) {
  const db = useDb()
  await db.insert(events).values({
    recipientId,
    tipo,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    referer: ctx.referer ?? null,
    meta: (ctx.meta ?? null) as never
  })

  // "primeira vez" nunca e sobrescrita — COALESCE preserva o valor original
  const agora = sql`now()`
  if (tipo === 'acesso') {
    await db
      .update(recipients)
      .set({ firstAccessAt: sql`coalesce(${recipients.firstAccessAt}, ${agora})` })
      .where(eq(recipients.id, recipientId))
  } else if (tipo === 'confirmacao') {
    await db
      .update(recipients)
      .set({ confirmedAt: sql`coalesce(${recipients.confirmedAt}, ${agora})` })
      .where(eq(recipients.id, recipientId))
  } else if (tipo === 'download') {
    await db
      .update(recipients)
      .set({
        firstDownloadAt: sql`coalesce(${recipients.firstDownloadAt}, ${agora})`,
        downloadCount: sql`${recipients.downloadCount} + 1`
      })
      .where(eq(recipients.id, recipientId))
  }
}

export async function registrarEventoDoRequest(
  event: H3Event,
  recipientId: number,
  tipo: TipoEvento,
  meta?: unknown
) {
  const ctx = clientContext(event)
  await registrarEvento(recipientId, tipo, { ...ctx, meta })
}

/**
 * Abertura tem tratamento proprio: alem de contar, classificamos se foi uma
 * pessoa ou o pre-carregamento automatico do cliente de e-mail. A conclusao
 * fica gravada junto com a evidencia (user-agent, IP, atraso), no evento,
 * para poder ser auditada depois.
 */
export async function registrarAbertura(event: H3Event, r: { id: number; sentAt: Date | null }) {
  const db = useDb()
  const ctx = clientContext(event)
  const { classe, motivo } = classificarAbertura({
    userAgent: ctx.userAgent,
    ip: ctx.ip,
    sentAt: r.sentAt
  })

  await db.insert(events).values({
    recipientId: r.id,
    tipo: 'abertura',
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    referer: ctx.referer,
    meta: { classe, motivo } as never
  })

  const agora = sql`now()`
  await db
    .update(recipients)
    .set({
      firstOpenAt: sql`coalesce(${recipients.firstOpenAt}, ${agora})`,
      lastOpenAt: agora,
      openCount: sql`${recipients.openCount} + 1`,
      // so a abertura que parece humana preenche este marco
      ...(classe === 'provavel-pessoa'
        ? { firstHumanOpenAt: sql`coalesce(${recipients.firstHumanOpenAt}, ${agora})` }
        : {})
    })
    .where(eq(recipients.id, r.id))

  return { classe, motivo }
}
