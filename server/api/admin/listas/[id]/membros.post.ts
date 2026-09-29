import { z } from 'zod'
import { operadorAtual } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { carregarLista, membroSchema, gravarMembros } from '../../../../utils/listas'

const schema = z.object({ membros: z.array(membroSchema).min(1).max(20000) })

/** Acrescenta contatos (digitados, colados ou de planilha); repetidos atualizam. */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const l = await carregarLista(Number(getRouterParam(event, 'id')))
  const { membros } = validar(schema, await readBody(event))
  const r = await gravarMembros(l.id, membros, op)
  await auditar(event, 'lista.acrescentar', {
    entidade: 'lista',
    id: l.id,
    resumo: `Acrescentou ${r.adicionados} contato(s) à lista "${l.nome}"${r.atualizados ? ` e atualizou ${r.atualizados}` : ''}`,
    dados: { adicionados: r.adicionados, atualizados: r.atualizados, invalidos: r.invalidos.length }
  })
  return r
})
