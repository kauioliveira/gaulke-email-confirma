import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb, supressao } from '../../../db'
import { exigirPapel } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'

const schema = z.object({ email: z.string().trim().toLowerCase().max(320) })

/**
 * Tira um endereco da supressao — quando se confirmou que ele voltou a existir
 * (caixa recriada, dominio renovado). Supervisor/admin: mandar para um
 * endereco que devolve prejudica a reputacao do servidor para TODOS os envios.
 */
export default defineEventHandler(async event => {
  exigirPapel(event, 'supervisor', 'tirar um endereço da lista de supressão')
  const { email } = validar(schema, await readBody(event))
  const [removido] = await useDb().delete(supressao).where(eq(supressao.email, email)).returning()
  if (!removido) throw createError({ statusCode: 404, statusMessage: 'Endereço não está suprimido' })
  await auditar(event, 'supressao.remover', {
    entidade: 'supressao',
    id: email,
    resumo: `Tirou ${email} da lista de supressão (motivo original: ${removido.motivo ?? '—'})`,
    dados: { email, motivo: removido.motivo, origem: removido.origem }
  })
  return { ok: true }
})
