import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, checklists, checklistItens } from '../db'
import { itemSolicSchema } from './solicitacoes'
import { setorAoSalvar, type Operador } from './permissoes'
import { nomesDosDepartamentos } from './departamentos'

export const checklistSchema = z.object({
  nome: z.string().trim().min(3, 'Dê um nome ao modelo').max(160),
  descricao: z.string().trim().max(1000).nullish().transform(v => v || null),
  // setor que ve o modelo; null = todos, ausente = o de quem salva
  departamentoId: z.number().int().positive().nullish(),
  itens: z.array(itemSolicSchema).min(1, 'Inclua pelo menos um item').max(40)
})

export type DadosChecklist = z.output<typeof checklistSchema>

/**
 * Setor do modelo ao salvar. `setor` (texto) continua gravado com o nome do
 * setor so para quem ainda le a coluna antiga — quem manda e departamentoId.
 */
export async function setorDoModelo(op: Operador, pedido: number | null | undefined) {
  const departamentoId = pedido === undefined ? op.departamentoId : setorAoSalvar(op, pedido)
  const setor = departamentoId == null ? null : ((await nomesDosDepartamentos()).get(departamentoId) ?? null)
  return { departamentoId, setor }
}

/** Troca os itens de um modelo pelos recebidos (a ordem e a da lista). */
export async function gravarItensChecklist(checklistId: number, itens: DadosChecklist['itens']) {
  const db = useDb()
  await db.transaction(async tx => {
    await tx.delete(checklistItens).where(eq(checklistItens.checklistId, checklistId))
    await tx.insert(checklistItens).values(itens.map((i, n) => ({ ...i, checklistId, ordem: n + 1 })))
  })
}

export async function criarChecklist(d: DadosChecklist, op: Operador) {
  const [m] = await useDb()
    .insert(checklists)
    .values({ nome: d.nome, descricao: d.descricao, ...(await setorDoModelo(op, d.departamentoId)), criadoPorNome: op.nome, atualizadoPorNome: op.nome })
    .returning()
  await gravarItensChecklist(m!.id, d.itens)
  return m!
}
