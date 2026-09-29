import { z } from 'zod'
import { useDb, listas } from '../../../db'
import { operadorAtual } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'
import { listaSchema, membroSchema, gravarMembros, erroNomeRepetido } from '../../../utils/listas'

const schema = listaSchema.extend({
  // "Salvar como lista" no novo envio: ja nasce com os destinatarios
  membros: z.array(membroSchema).max(20000).default([])
})

/** Nova lista. Qualquer usuario cria. */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const d = validar(schema, await readBody(event))
  let criada
  try {
    ;[criada] = await useDb()
      .insert(listas)
      .values({
        nome: d.nome,
        descricao: d.descricao || null,
        criadoPorUserId: op.id,
        criadoPorNome: op.nome,
        atualizadoPorNome: op.nome
      })
      .returning()
  } catch (e) {
    if (erroNomeRepetido(e)) throw createError({ statusCode: 409, statusMessage: `Já existe uma lista chamada "${d.nome}".` })
    throw e
  }
  const r = d.membros.length ? await gravarMembros(criada!.id, d.membros, op) : { adicionados: 0, atualizados: 0, invalidos: [] }
  await auditar(event, 'lista.criar', {
    entidade: 'lista',
    id: criada!.id,
    resumo: `Criou a lista "${d.nome}" com ${r.adicionados} contato(s)`,
    dados: { nome: d.nome, descricao: d.descricao ?? null, contatos: r.adicionados }
  })
  return { id: criada!.id, ...r }
})
