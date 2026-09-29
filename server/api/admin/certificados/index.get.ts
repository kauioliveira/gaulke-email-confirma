import { desc, isNull } from 'drizzle-orm'
import { useDb, certificados } from '../../../db'
import { exigirPapel } from '../../../utils/permissoes'
import { resumoCertificado } from '../../../utils/certificados'

export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'ver os certificados')
  const lista = await useDb()
    .select()
    .from(certificados)
    .where(isNull(certificados.revogadoEm))
    .orderBy(desc(certificados.padrao), desc(certificados.validoAte))
  return lista.map(c => ({
    ...resumoCertificado(c),
    padrao: c.padrao,
    nomeArquivo: c.nomeArquivo,
    criadoPorNome: c.criadoPorNome,
    criadoEm: c.criadoEm.toISOString(),
    ultimoTesteEm: c.ultimoTesteEm?.toISOString() ?? null,
    ultimoTesteOk: c.ultimoTesteOk,
    ultimoTesteMsg: c.ultimoTesteMsg
  }))
})
