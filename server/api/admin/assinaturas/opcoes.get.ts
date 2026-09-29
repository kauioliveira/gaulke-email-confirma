import { and, desc, gt, isNull } from 'drizzle-orm'
import { useDb, certificados } from '../../../db'

/** Certificados que podem selar agora (validos e nao removidos). So o publico. */
export default defineEventHandler(async () => {
  const lista = await useDb()
    .select({ id: certificados.id, nome: certificados.nome, titular: certificados.titular, documento: certificados.documento, validoAte: certificados.validoAte, padrao: certificados.padrao })
    .from(certificados)
    .where(and(isNull(certificados.revogadoEm), gt(certificados.validoAte, new Date())))
    .orderBy(desc(certificados.padrao), desc(certificados.validoAte))
  return { certificados: lista.map(c => ({ ...c, validoAte: c.validoAte.toISOString() })) }
})
