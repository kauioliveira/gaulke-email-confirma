import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb, checklists, checklistItens } from '../db'
import { itemSolicSchema } from './solicitacoes'
import type { Operador } from './permissoes'

export const checklistSchema = z.object({
  nome: z.string().trim().min(3, 'Dê um nome ao modelo').max(160),
  descricao: z.string().trim().max(1000).nullish().transform(v => v || null),
  setor: z.string().trim().max(60).nullish().transform(v => v || null),
  itens: z.array(itemSolicSchema).min(1, 'Inclua pelo menos um documento').max(40)
})

export type DadosChecklist = z.output<typeof checklistSchema>

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
    .values({ nome: d.nome, descricao: d.descricao, setor: d.setor, criadoPorNome: op.nome, atualizadoPorNome: op.nome })
    .returning()
  await gravarItensChecklist(m!.id, d.itens)
  return m!
}
