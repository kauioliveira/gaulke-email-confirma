import { and, eq, isNull, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, solicItens, solicArquivos } from '../../../../../../db'
import { operadorAtual } from '../../../../../../utils/permissoes'
import { auditar } from '../../../../../../utils/auditoria'
import { carregarSolicitacao, recalcularStatus, registrarEventoSolic } from '../../../../../../utils/solicitacoes'
import { apagarDocumento, codigoSolicitacao } from '../../../../../../utils/documentos'

const schema = z.object({
  acao: z.enum(['aprovar', 'recusar', 'aceitar', 'desfazer']),
  motivo: z.string().trim().max(500).nullish(),
  /** na recusa: tira da pasta os arquivos recusados (ilegivel, documento errado) */
  descartarArquivos: z.boolean().default(true)
})

/**
 * Analise de um item:
 *   aprovar   o arquivo enviado serve
 *   aceitar   o cliente disse "nao possuo" e a justificativa basta
 *   recusar   precisa de novo envio (motivo obrigatorio: vai para o cliente)
 *   desfazer  volta o item a como o cliente deixou
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const s = await carregarSolicitacao(Number(getRouterParam(event, 'id')))
  const itemId = Number(getRouterParam(event, 'itemId'))
  const d = validar(schema, await readBody(event))
  const db = useDb()

  if (s.status !== 'aberta' && s.status !== 'em_analise') {
    throw createError({ statusCode: 409, statusMessage: 'A solicitação está encerrada. Reabra para analisar de novo.' })
  }
  const [item] = await db.select().from(solicItens).where(and(eq(solicItens.id, itemId), eq(solicItens.solicId, s.id)))
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Item não encontrado' })

  const ativos = await db
    .select()
    .from(solicArquivos)
    .where(and(eq(solicArquivos.itemId, item.id), isNull(solicArquivos.removidoEm)))
  const liberados = ativos.filter(a => a.antivirus === 'limpo' || a.antivirus === 'sem_antivirus')
  const agora = new Date()
  let descricao = ''

  if (d.acao === 'aprovar') {
    if (!liberados.length) throw createError({ statusCode: 409, statusMessage: 'Não há arquivo liberado neste item para aprovar.' })
    await db
      .update(solicItens)
      .set({ status: 'aprovado', motivo: null, analisadoEm: agora, analisadoPorNome: op.nome })
      .where(eq(solicItens.id, item.id))
    descricao = `Aprovou "${item.titulo}" (${liberados.length} arquivo(s))`
  } else if (d.acao === 'aceitar') {
    if (item.status !== 'nao_possui') throw createError({ statusCode: 409, statusMessage: 'O cliente não marcou "não possuo" neste item.' })
    await db.update(solicItens).set({ analisadoEm: agora, analisadoPorNome: op.nome }).where(eq(solicItens.id, item.id))
    descricao = `Aceitou "não possuo" em "${item.titulo}"`
  } else if (d.acao === 'recusar') {
    const motivo = d.motivo?.trim()
    if (!motivo || motivo.length < 3) {
      throw createError({ statusCode: 400, statusMessage: 'Diga ao cliente o que precisa mudar (o motivo vai no e-mail).' })
    }
    if (item.status === 'pendente') throw createError({ statusCode: 409, statusMessage: 'O cliente ainda não enviou este item.' })
    await db
      .update(solicItens)
      .set({ status: 'recusado', motivo, analisadoEm: agora, analisadoPorNome: op.nome, recusaAvisadaEm: null })
      .where(eq(solicItens.id, item.id))
    if (d.descartarArquivos && ativos.length) {
      for (const a of ativos) await apagarDocumento(a.caminho)
      await db.update(solicArquivos).set({ removidoEm: agora }).where(inArray(solicArquivos.id, ativos.map(a => a.id)))
    }
    descricao = `Recusou "${item.titulo}": ${motivo}${d.descartarArquivos && ativos.length ? ` (${ativos.length} arquivo(s) descartado(s))` : ''}`
  } else {
    const volta = item.status === 'nao_possui' ? 'nao_possui' : liberados.length ? 'enviado' : 'pendente'
    await db
      .update(solicItens)
      .set({
        status: volta,
        // no "nao possuo" o motivo e a justificativa do cliente: fica
        motivo: volta === 'nao_possui' ? item.motivo : null,
        analisadoEm: null,
        analisadoPorNome: null,
        recusaAvisadaEm: null
      })
      .where(eq(solicItens.id, item.id))
    descricao = `Desfez a análise de "${item.titulo}"`
  }

  await registrarEventoSolic(s.id, `item_${d.acao}`, descricao, { itemId: item.id, porNome: op.nome })
  const r = await recalcularStatus(s.id, op.nome)
  await auditar(event, `solicitacao.item_${d.acao}`, {
    entidade: 'solicitacao',
    id: s.id,
    resumo: `${descricao} — ${codigoSolicitacao(s.id)} de ${s.destinatarioEmail}`,
    dados: { itemId: item.id, acao: d.acao, motivo: d.motivo ?? null, statusAntes: item.status, solicitacao: r }
  })
  return { ok: true, status: r.depois }
})
