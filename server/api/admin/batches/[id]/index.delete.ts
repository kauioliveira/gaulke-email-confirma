import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb, batches } from '../../../../db'
import { loteEmExecucao, pausarLote } from '../../../../utils/sender'
import { exigirPapel, operadorAtual, temPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'

const schema = z.object({
  motivo: z.string().trim().max(500).optional()
})

/**
 * Exclui um lote (decisao D2).
 *
 *  - NUNCA DISPARADO (nenhum envio, nunca iniciado): exclusao FISICA, por quem
 *    criou ou por supervisor/admin. Nao ha prova nenhuma a perder. Lotes
 *    antigos sem autoria gravada ficam livres — nao ha a quem atribuir.
 *  - JA DISPARADO: so supervisor/admin, com MOTIVO, e a exclusao e LOGICA — o
 *    lote vai para a lixeira. Some das telas, relatorios e contatos, e os
 *    links do destinatario deixam de abrir, mas destinatarios e eventos (a
 *    prova de que o cliente foi avisado) continuam guardados. O admin restaura
 *    pela Lixeira.
 */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const db = useDb()

  const [lote] = await db.select().from(batches).where(eq(batches.id, id))
  if (!lote || lote.excluidoEm) throw createError({ statusCode: 404, statusMessage: 'Lote nao encontrado' })

  const jaEnviou = lote.enviados > 0 || lote.falhas > 0 || lote.startedAt !== null

  if (!jaEnviou) {
    const op = operadorAtual(event)
    const eDono = lote.criadoPorUserId === null || lote.criadoPorUserId === op.id
    if (!eDono && !temPapel(op, 'supervisor')) {
      throw createError({
        statusCode: 403,
        statusMessage: `Somente quem criou o lote (${lote.criadoPorNome}), supervisores e administradores podem excluí-lo.`
      })
    }

    // destinatarios e eventos caem junto por ON DELETE CASCADE
    await db.delete(batches).where(eq(batches.id, id))
    await auditar(event, 'lote.excluir', {
      entidade: 'lote',
      id,
      resumo: `Excluiu o lote "${lote.nome}" (${lote.total} destinatário(s), nunca disparado)`,
      dados: { nome: lote.nome, status: lote.status, assunto: lote.assuntoSnapshot, total: lote.total, criadoPor: lote.criadoPorNome }
    })
    return { ok: true, lixeira: false }
  }

  const op = exigirPapel(event, 'supervisor', 'excluir um lote que já foi disparado')
  const { motivo } = validar(schema, (await readBody(event).catch(() => ({}))) ?? {})
  if (!motivo || motivo.length < 3) {
    throw createError({ statusCode: 400, statusMessage: 'Informe o motivo para excluir um lote já disparado' })
  }

  if (loteEmExecucao(id)) await pausarLote(id)
  await db
    .update(batches)
    .set({
      excluidoEm: new Date(),
      excluidoPorNome: op.nome,
      excluidoMotivo: motivo,
      // nada da lixeira pode voltar a rodar sozinho
      ...(lote.status === 'enviando' || lote.status === 'agendado'
        ? { status: 'pausado', agendadoPara: null, agendadoEm: null }
        : {})
    })
    .where(eq(batches.id, id))

  await auditar(event, 'lote.lixeira', {
    entidade: 'lote',
    id,
    resumo: `Mandou para a lixeira o lote "${lote.nome}" (${lote.enviados} enviado(s)). Motivo: ${motivo}`,
    dados: { nome: lote.nome, status: lote.status, total: lote.total, enviados: lote.enviados, motivo }
  })
  return { ok: true, lixeira: true }
})
