import { eq, sql } from 'drizzle-orm'
import { useDb, solicItens, solicitacoes } from '../../../../../db'
import { operadorAtual } from '../../../../../utils/permissoes'
import { auditar } from '../../../../../utils/auditoria'
import { carregarSolicitacao, itemSolicSchema, recalcularStatus, registrarEventoSolic } from '../../../../../utils/solicitacoes'
import { codigoSolicitacao } from '../../../../../utils/documentos'

/**
 * Pede mais um documento numa solicitacao ja enviada ("faltou o contrato de
 * locacao"). O cliente ve o item novo no mesmo link; o aviso por e-mail e o
 * "Enviar lembrete" da tela.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const s = await carregarSolicitacao(Number(getRouterParam(event, 'id')))
  const d = validar(itemSolicSchema, await readBody(event))
  if (s.status === 'cancelada') throw createError({ statusCode: 409, statusMessage: 'A solicitação foi cancelada. Reabra antes.' })
  const db = useDb()
  const [{ proxima } = { proxima: 1 }] = await db
    .select({ proxima: sql<number>`coalesce(max(${solicItens.ordem}), 0)::int + 1` })
    .from(solicItens)
    .where(eq(solicItens.solicId, s.id))
  const [item] = await db.insert(solicItens).values({ ...d, solicId: s.id, ordem: proxima }).returning()
  await registrarEventoSolic(s.id, 'item_incluido', `Incluiu o item "${d.titulo}"${d.obrigatorio ? '' : ' (opcional)'}`, {
    itemId: item!.id,
    porNome: op.nome
  })
  // concluida com item obrigatorio novo volta a esperar o cliente
  if (s.status === 'concluida' && d.obrigatorio) {
    await db.update(solicitacoes).set({ status: 'aberta', concluidaEm: null, concluidaPorNome: null }).where(eq(solicitacoes.id, s.id))
  }
  await recalcularStatus(s.id, op.nome)
  await auditar(event, 'solicitacao.incluir_item', {
    entidade: 'solicitacao',
    id: s.id,
    resumo: `Incluiu "${d.titulo}" na ${codigoSolicitacao(s)} (${s.destinatarioEmail})`,
    dados: { item: d }
  })
  return { id: item!.id }
})
