import { desc, sql } from 'drizzle-orm'
import { useDb, webhooks } from '../../../db'
import { exigirPapel } from '../../../utils/permissoes'
import { EVENTOS_WEBHOOK } from '../../../utils/webhooks'
import type { WebhookCadastrado } from '../../../../shared/types/api'

/** Webhooks cadastrados (sem o segredo) e os eventos que existem. So admin. */
export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'ver os webhooks')
  const linhas = await useDb()
    .select({
      id: webhooks.id,
      nome: webhooks.nome,
      url: webhooks.url,
      eventos: webhooks.eventos,
      ativo: webhooks.ativo,
      ultimaEntregaEm: webhooks.ultimaEntregaEm,
      ultimoStatus: webhooks.ultimoStatus,
      ultimoErro: webhooks.ultimoErro,
      criadoPorNome: webhooks.criadoPorNome,
      atualizadoPorNome: webhooks.atualizadoPorNome,
      // qualificada a mao: "id" sozinho, dentro da subconsulta, seria o da entrega
      pendentes: sql<number>`(select count(*)::int from sys_mail_webhook_entregas e where e.webhook_id = sys_mail_webhooks.id and e.status = 'pendente')`,
      falhas: sql<number>`(select count(*)::int from sys_mail_webhook_entregas e where e.webhook_id = sys_mail_webhooks.id and e.status = 'erro')`
    })
    .from(webhooks)
    .orderBy(desc(webhooks.id))
  return {
    webhooks: linhas.map(l => ({ ...l, ultimaEntregaEm: l.ultimaEntregaEm?.toISOString() ?? null })) as WebhookCadastrado[],
    eventos: Object.entries(EVENTOS_WEBHOOK).map(([valor, rotulo]) => ({ valor, rotulo }))
  }
})
