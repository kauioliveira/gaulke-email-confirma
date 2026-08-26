import { desc } from 'drizzle-orm'
import { useDb, templates } from '../../../db'

export default defineEventHandler(async () => ({
  templates: await useDb().select().from(templates).orderBy(desc(templates.updatedAt))
}))
