import { desc, isNotNull } from 'drizzle-orm'
import { useDb, batches } from '../../db'
import { exigirPapel } from '../../utils/permissoes'
import { lerConfig } from '../../utils/config'

/** Lotes na lixeira, do mais recente para o mais antigo. So admin. */
export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'ver a lixeira')
  const lotes = await useDb()
    .select({
      id: batches.id,
      nome: batches.nome,
      assunto: batches.assuntoSnapshot,
      total: batches.total,
      enviados: batches.enviados,
      criadoPorNome: batches.criadoPorNome,
      disparadoPorNome: batches.disparadoPorNome,
      startedAt: batches.startedAt,
      excluidoEm: batches.excluidoEm,
      excluidoPorNome: batches.excluidoPorNome,
      excluidoMotivo: batches.excluidoMotivo
    })
    .from(batches)
    .where(isNotNull(batches.excluidoEm))
    .orderBy(desc(batches.excluidoEm))
    .limit(500)
  // a retencao apaga de vez depois de N dias na lixeira: a tela mostra quando
  const r = await lerConfig('retencao')
  return { lotes, apagarAposDias: r.ativa ? r.lixeiraDias : null }
})
