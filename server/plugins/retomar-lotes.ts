import { eq } from 'drizzle-orm'
import { useDb, batches } from '../db'
import { destravarOrfaos, iniciarLote } from '../utils/sender'
import { checarBaseUrl } from '../utils/urls'
import { garantirTemplatePadrao } from '../utils/seed'

/**
 * No boot: avisa sobre configuracao invalida e retoma qualquer lote que
 * estava enviando quando o processo caiu, sem reenviar quem ja recebeu.
 */
export default defineNitroPlugin(async () => {
  const aviso = checarBaseUrl()
  if (aviso) console.warn(`[gaulke-mail] ATENCAO: ${aviso}`)

  try {
    await garantirTemplatePadrao()

    const destravados = await destravarOrfaos()
    if (destravados) {
      console.info(`[gaulke-mail] ${destravados} envio(s) travado(s) voltaram para a fila`)
    }

    const emAndamento = await useDb()
      .select({ id: batches.id, nome: batches.nome })
      .from(batches)
      .where(eq(batches.status, 'enviando'))

    for (const lote of emAndamento) {
      console.info(`[gaulke-mail] retomando lote #${lote.id} (${lote.nome})`)
      await iniciarLote(lote.id)
    }
  } catch (e) {
    console.error('[gaulke-mail] falha ao retomar lotes:', e instanceof Error ? e.message : e)
  }
})
