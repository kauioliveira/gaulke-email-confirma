import { desc, eq } from 'drizzle-orm'
import { useDb, webhookEntregas } from '../../../../db'
import { exigirPapel } from '../../../../utils/permissoes'
import type { EntregaWebhook } from '../../../../../shared/types/api'

/** Ultimas entregas de um webhook, para ver o que falhou e reenviar. */
export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'ver as entregas de webhooks')
  const linhas = await useDb()
    .select()
    .from(webhookEntregas)
    .where(eq(webhookEntregas.webhookId, Number(getRouterParam(event, 'id'))))
    .orderBy(desc(webhookEntregas.id))
    .limit(50)
  return linhas.map(l => ({
    id: l.id,
    evento: l.evento,
    status: l.status,
    tentativas: l.tentativas,
    ultimoStatusHttp: l.ultimoStatusHttp,
    ultimoErro: l.ultimoErro,
    criadoEm: l.criadoEm.toISOString(),
    entregueEm: l.entregueEm?.toISOString() ?? null,
    proximaTentativaEm: l.proximaTentativaEm.toISOString()
  })) as EntregaWebhook[]
})
