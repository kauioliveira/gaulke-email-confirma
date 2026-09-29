import { and, eq, isNull } from 'drizzle-orm'
import { useDb, certificados } from '../../../../db'
import { exigirPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'

/**
 * Remove o certificado do sistema. O registro fica (os documentos ja selados
 * apontam para ele), mas a chave cifrada e APAGADA: depois disso nada mais
 * assina com ele, nem com acesso ao banco e a chave do .env.
 */
export default defineEventHandler(async event => {
  const op = exigirPapel(event, 'admin', 'remover certificados')
  const id = Number(getRouterParam(event, 'id'))
  const db = useDb()
  const [c] = await db.select().from(certificados).where(and(eq(certificados.id, id), isNull(certificados.revogadoEm)))
  if (!c) throw createError({ statusCode: 404, statusMessage: 'Certificado não encontrado' })
  await db
    .update(certificados)
    .set({ revogadoEm: new Date(), revogadoPorNome: op.nome, chaveCifrada: '', padrao: false })
    .where(eq(certificados.id, id))
  await auditar(event, 'certificado.remover', {
    entidade: 'certificado',
    id,
    resumo: `Removeu o certificado "${c.nome}" (${c.titular}); a chave privada foi apagada`
  })
  return { ok: true }
})
