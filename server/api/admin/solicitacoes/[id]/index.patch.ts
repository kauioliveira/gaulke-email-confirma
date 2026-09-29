import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, solicitacoes } from '../../../../db'
import { auditar } from '../../../../utils/auditoria'
import { carregarSolicitacao, registrarEventoSolic } from '../../../../utils/solicitacoes'
import { operadorAtual } from '../../../../utils/permissoes'

const schema = z.object({
  prazo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  lembretes: z.boolean().optional(),
  avisarConclusao: z.boolean().optional()
})

/** Ajustes depois de criada: prazo, lembretes e aviso de conclusao. */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const s = await carregarSolicitacao(Number(getRouterParam(event, 'id')))
  const d = validar(schema, await readBody(event))
  const mudou: Record<string, { de: unknown; para: unknown }> = {}
  if (d.prazo !== undefined && d.prazo !== s.prazo) mudou.prazo = { de: s.prazo, para: d.prazo }
  if (d.lembretes !== undefined && d.lembretes !== s.lembretes) mudou.lembretes = { de: s.lembretes, para: d.lembretes }
  if (d.avisarConclusao !== undefined && d.avisarConclusao !== s.avisarConclusao) {
    mudou.avisarConclusao = { de: s.avisarConclusao, para: d.avisarConclusao }
  }
  if (!Object.keys(mudou).length) return { ok: true }

  await useDb()
    .update(solicitacoes)
    .set({
      ...(mudou.prazo ? { prazo: d.prazo ?? null } : {}),
      ...(mudou.lembretes ? { lembretes: d.lembretes } : {}),
      ...(mudou.avisarConclusao ? { avisarConclusao: d.avisarConclusao } : {})
    })
    .where(eq(solicitacoes.id, s.id))

  const partes = [
    mudou.prazo && `prazo ${mudou.prazo.para ? formatarData(`${mudou.prazo.para}T12:00:00${DESLOCAMENTO_SP}`) : 'removido'}`,
    mudou.lembretes && `lembretes ${d.lembretes ? 'ligados' : 'desligados'}`,
    mudou.avisarConclusao && `aviso de conclusão ${d.avisarConclusao ? 'ligado' : 'desligado'}`
  ].filter(Boolean)
  await registrarEventoSolic(s.id, 'ajuste', `Ajustou: ${partes.join(', ')}`, { porNome: op.nome })
  await auditar(event, 'solicitacao.ajustar', {
    entidade: 'solicitacao',
    id: s.id,
    resumo: `Ajustou a solicitação "${s.titulo}" de ${s.destinatarioEmail}: ${partes.join(', ')}`,
    dados: mudou
  })
  return { ok: true }
})
