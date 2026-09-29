import { z } from 'zod'
import { operadorAtual } from '../../../../utils/permissoes'
import { enfileirarReenvio } from '../../../../utils/reenvio'
import { auditar } from '../../../../utils/auditoria'

const schema = z
  .object({
    ids: z.array(z.number().int().positive()).max(5000).optional(),
    /** todos que receberam e ainda nao confirmaram a leitura */
    naoConfirmou: z.boolean().optional(),
    motivo: z.string().trim().min(3, 'Informe o motivo do reenvio').max(500)
  })
  .refine(d => d.naoConfirmou || d.ids?.length, { message: 'Escolha quem reenviar' })

/**
 * Reenvio em massa pela fila do lote, respeitando o intervalo entre envios.
 * Cada pessoa ganha um novo envio numerado no historico quando o worker a
 * alcancar.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const id = Number(getRouterParam(event, 'id'))
  const d = validar(schema, await readBody(event))

  const r = await enfileirarReenvio(id, d, op)

  if (r.enfileirados) {
    await auditar(event, 'lote.reenviar', {
      entidade: 'lote',
      id,
      resumo:
        `Colocou ${r.enfileirados} pessoa(s) do lote "${r.lote.nome}" na fila de reenvio` +
        (d.naoConfirmou ? ' (quem não confirmou a leitura)' : ' (selecionadas)'),
      dados: { enfileirados: r.enfileirados, naoConfirmou: !!d.naoConfirmou, ids: d.ids ?? null, motivo: d.motivo }
    })
  }

  return { ok: true, enfileirados: r.enfileirados }
})
