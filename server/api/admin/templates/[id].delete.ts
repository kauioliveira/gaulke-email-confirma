import { eq } from 'drizzle-orm'
import { useDb, templates } from '../../../db'

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  await useDb().delete(templates).where(eq(templates.id, id))
  return { ok: true }
})
