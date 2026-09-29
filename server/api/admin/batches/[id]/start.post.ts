import { eq } from 'drizzle-orm'
import { useDb, batches } from '../../../../db'
import { iniciarLote } from '../../../../utils/sender'
import { resolverConta } from '../../../../utils/mailer'
import { checarBaseUrl } from '../../../../utils/urls'
import { auditar } from '../../../../utils/auditoria'

export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const [atual] = await useDb().select().from(batches).where(eq(batches.id, id))
  if (!atual || atual.excluidoEm) throw createError({ statusCode: 404, statusMessage: 'Lote nao encontrado' })

  /**
   * Confere o CANAL do lote, e nao o NUXT_SMTP_ENABLED do .env: desde que os
   * canais foram para o banco, o .env so vale como ultimo recurso. Antes, um
   * .env com SMTP desligado travava o disparo mesmo com um canal ativo, e um
   * canal desativado so aparecia como falha no meio do lote.
   */
  const conta = await resolverConta(atual.contaId).catch(e => {
    throw createError({ statusCode: 400, statusMessage: `Canal de saída indisponível: ${e instanceof Error ? e.message : e}` })
  })
  if (!conta.enabled) {
    throw createError({ statusCode: 400, statusMessage: `O canal de saída "${conta.nome}" está desativado` })
  }
  const aviso = checarBaseUrl()

  // Registrado ANTES de iniciar: se o disparo falhar, ainda se sabe quem tentou.
  const operador = event.context.operador
  const [lote] = operador
    ? await useDb()
        .update(batches)
        .set({ disparadoPorUserId: operador.id, disparadoPorNome: operador.nome })
        .where(eq(batches.id, id))
        .returning({ nome: batches.nome, total: batches.total })
    : await useDb().select({ nome: batches.nome, total: batches.total }).from(batches).where(eq(batches.id, id))

  const r = await iniciarLote(id)
  await auditar(event, 'lote.disparar', {
    entidade: 'lote',
    id,
    resumo: `Disparou o lote "${lote?.nome ?? id}" (${lote?.total ?? 0} destinatário(s))`
  })
  return { ...r, aviso }
})
