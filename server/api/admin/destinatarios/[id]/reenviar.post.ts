import { z } from 'zod'
import { operadorAtual } from '../../../../utils/permissoes'
import { reenviarAgora } from '../../../../utils/reenvio'
import { auditar } from '../../../../utils/auditoria'

const schema = z.object({
  /** e-mail corrigido; ausente ou igual = o mesmo endereco */
  para: z.string().max(320).nullish(),
  motivo: z.string().trim().min(3, 'Informe o motivo do reenvio').max(500),
  /** outro canal de saida; ausente = o do lote */
  contaId: z.number().int().positive().nullish()
})

/**
 * Reenvia agora o e-mail do lote para UMA pessoa ("o cliente diz que nao
 * recebeu"). O resultado — enviado ou falhou — volta para a tela e fica no
 * historico de envios do destinatario.
 */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const id = Number(getRouterParam(event, 'id'))
  const d = validar(schema, await readBody(event))

  const r = await reenviarAgora(id, d, op)

  await auditar(event, 'destinatario.reenviar', {
    entidade: 'destinatario',
    id,
    resumo:
      `${r.ok ? 'Reenviou' : 'Tentou reenviar'} (envio nº ${r.numero}) o lote "${r.loteNome}" para ${r.para}` +
      (r.emailAnterior ? `, corrigindo o e-mail de ${r.emailAnterior}` : '') +
      (r.ok ? '' : ` — falhou: ${r.erro}`),
    dados: {
      loteId: r.loteId,
      envio: r.numero,
      para: r.para,
      emailAnterior: r.emailAnterior,
      canal: r.canal,
      motivo: d.motivo,
      ok: r.ok
    }
  })

  return r
})
