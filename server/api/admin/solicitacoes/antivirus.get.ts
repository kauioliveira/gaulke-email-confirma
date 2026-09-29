import { sql } from 'drizzle-orm'
import { useDb } from '../../../db'
import { estadoAntivirus } from '../../../utils/antivirus'

/** Estado do antivirus e da quarentena, para a tela. */
export default defineEventHandler(async () => {
  const estado = await estadoAntivirus()
  const [q] = await useDb().execute<{ quarentena: number }>(
    sql`select count(*)::int as quarentena from sys_mail_solic_arquivos where antivirus in ('pendente', 'erro') and removido_em is null`
  )
  return { ...estado, quarentena: q?.quarentena ?? 0 }
})
