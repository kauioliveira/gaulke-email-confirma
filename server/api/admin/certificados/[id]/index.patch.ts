import { and, eq, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, certificados } from '../../../../db'
import { exigirPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'

const schema = z.object({ nome: z.string().trim().min(3).max(120).optional(), padrao: z.literal(true).optional() })

/** Renomear ou tornar padrao (o que o "Assinar como Gaulke" usa). */
export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'alterar certificados')
  const id = Number(getRouterParam(event, 'id'))
  const d = validar(schema, await readBody(event))
  const db = useDb()
  const [c] = await db.select().from(certificados).where(and(eq(certificados.id, id), isNull(certificados.revogadoEm)))
  if (!c) throw createError({ statusCode: 404, statusMessage: 'Certificado não encontrado' })
  if (d.padrao) await db.update(certificados).set({ padrao: false }).where(ne(certificados.id, id))
  await db.update(certificados).set({ ...(d.nome ? { nome: d.nome } : {}), ...(d.padrao ? { padrao: true } : {}) }).where(eq(certificados.id, id))
  await auditar(event, 'certificado.alterar', {
    entidade: 'certificado',
    id,
    resumo: `${d.padrao ? `Tornou padrão o certificado "${c.nome}"` : ''}${d.nome && d.padrao ? '; ' : ''}${d.nome ? `Renomeou "${c.nome}" para "${d.nome}"` : ''}`
  })
  return { ok: true }
})
