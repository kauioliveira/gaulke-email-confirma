import { and, eq } from 'drizzle-orm'
import { useDb, recipients, batches } from '../../../db'
import { registrarEventoDoRequest } from '../../../utils/tracking'
import { foraDaLixeira } from '../../../utils/lotes'
import { emitirWebhook } from '../../../utils/webhooks'
import { camposComRespostas, exigirCamposPreenchidos } from '../../../utils/lote-campos'

/** Confirmacao explicita de leitura — esta e a prova real, com IP e horario. */
export default defineEventHandler(async event => {
  const token = getRouterParam(event, 'token') || ''
  const r = (
    await useDb()
      .select({
        id: recipients.id,
        confirmedAt: recipients.confirmedAt,
        email: recipients.email,
        nome: recipients.nome,
        empresa: recipients.empresa,
        documento: recipients.documento,
        codigo: recipients.codigo,
        loteId: batches.id,
        loteNome: batches.nome
      })
      .from(recipients)
      .innerJoin(batches, eq(batches.id, recipients.batchId))
      .where(and(eq(recipients.token, token), foraDaLixeira))
  )[0]

  if (!r) throw createError({ statusCode: 404, statusMessage: 'Link invalido ou expirado' })

  // idempotente: reconfirmar nao sobrescreve o primeiro aceite
  if (r.confirmedAt) return { ok: true, confirmadoEm: r.confirmedAt, jaConfirmado: true }

  // a ciencia vale junto com o que o cliente informou: sem os obrigatorios, nao confirma
  await exigirCamposPreenchidos(r.loteId, r.id)

  await registrarEventoDoRequest(event, r.id, 'confirmacao', { aceite: 'Li e estou ciente' })
  const atualizado = (
    await useDb()
      .select({ confirmedAt: recipients.confirmedAt })
      .from(recipients)
      .where(eq(recipients.id, r.id))
  )[0]

  await emitirWebhook(
    'comunicado.confirmado',
    {
      destinatarioId: r.id,
      codigo: r.codigo,
      destinatario: { nome: r.nome, email: r.email, empresa: r.empresa, documento: r.documento },
      lote: { id: r.loteId, nome: r.loteNome },
      campos: (await camposComRespostas(r.loteId, r.id))
        .filter(c => c.resposta)
        .map(c => ({ titulo: c.titulo, tipo: c.tipo, resposta: c.resposta!.exibicao })),
      confirmadoEm: atualizado?.confirmedAt ?? null
    },
    `/admin/destinatario/${r.id}`
  )
  return { ok: true, confirmadoEm: atualizado?.confirmedAt, jaConfirmado: false }
})
