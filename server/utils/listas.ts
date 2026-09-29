import { z } from 'zod'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { useDb, listas, listaMembros, supressao, type Lista } from '../db'
import type { Operador } from './permissoes'
import type { DetalheLista, ResumoLista } from '../../shared/types/api'

/**
 * Listas de contatos salvas ("Clientes do Simples", "DP - folha"): montadas
 * uma vez e reusadas no novo envio e nas solicitacoes.
 *
 * A lista e so um ponto de partida: ao usa-la, os membros sao COPIADOS para o
 * lote. Mudar a lista depois nao altera um envio ja feito — o lote guarda o
 * seu proprio retrato de quem recebeu.
 */

const RE_EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/

export const membroSchema = z.object({
  email: z.string().trim().toLowerCase().max(320),
  nome: z.string().trim().max(200).nullish(),
  empresa: z.string().trim().max(200).nullish(),
  documento: z.string().trim().max(30).nullish(),
  extras: z.record(z.string().max(500)).nullish()
})

export const listaSchema = z.object({
  nome: z.string().trim().min(2, 'Dê um nome à lista').max(160),
  descricao: z.string().trim().max(1000).nullish()
})

export type MembroEntrada = z.infer<typeof membroSchema>

const soDigitos = (v?: string | null) => {
  const d = (v || '').replace(/\D/g, '')
  return d.length === 11 || d.length === 14 ? d : null
}

export function erroNomeRepetido(e: unknown) {
  return (e as { code?: string })?.code === '23505'
}

export async function resumosDasListas(): Promise<ResumoLista[]> {
  const linhas = await useDb()
    .select({
      id: listas.id,
      nome: listas.nome,
      descricao: listas.descricao,
      criadoPorNome: listas.criadoPorNome,
      atualizadoPorNome: listas.atualizadoPorNome,
      atualizadoEm: listas.atualizadoEm,
      // qualificada a mao: no select o Drizzle escreve so "id", que dentro da
      // subconsulta seria o id do MEMBRO
      total: sql<number>`(select count(*)::int from sys_mail_lista_membros m where m.lista_id = sys_mail_listas.id)`
    })
    .from(listas)
    .orderBy(asc(sql`lower(${listas.nome})`))
  return linhas.map(l => ({ ...l, atualizadoEm: l.atualizadoEm.toISOString() }))
}

export async function carregarLista(id: number): Promise<Lista> {
  const [l] = await useDb().select().from(listas).where(eq(listas.id, id))
  if (!l) throw createError({ statusCode: 404, statusMessage: 'Lista não encontrada' })
  return l
}

export async function detalheLista(id: number): Promise<DetalheLista> {
  const l = await carregarLista(id)
  const membros = await useDb()
    .select({
      id: listaMembros.id,
      email: listaMembros.email,
      nome: listaMembros.nome,
      empresa: listaMembros.empresa,
      documento: listaMembros.documento,
      extras: listaMembros.extras,
      adicionadoEm: listaMembros.adicionadoEm,
      suprimidoEmail: supressao.email,
      suprimidoMotivo: supressao.motivo
    })
    .from(listaMembros)
    .leftJoin(supressao, eq(supressao.email, listaMembros.email))
    .where(eq(listaMembros.listaId, id))
    .orderBy(asc(sql`lower(coalesce(${listaMembros.nome}, ${listaMembros.email}))`))
  return {
    id: l.id,
    nome: l.nome,
    descricao: l.descricao,
    criadoPorNome: l.criadoPorNome,
    atualizadoPorNome: l.atualizadoPorNome,
    atualizadoEm: l.atualizadoEm.toISOString(),
    total: membros.length,
    membros: membros.map(({ suprimidoEmail, suprimidoMotivo, ...m }) => ({
      ...m,
      adicionadoEm: m.adicionadoEm.toISOString(),
      // supressao sem motivo gravado ainda e supressao
      suprimido: suprimidoEmail ? suprimidoMotivo || 'devolveu antes' : null
    }))
  }
}

/**
 * Acrescenta (ou atualiza, pelo e-mail) membros. Quem ja esta na lista tem
 * nome, empresa e documento atualizados so quando o novo valor veio preenchido
 * — importar uma planilha sem a coluna "Empresa" nao apaga a empresa de todos.
 */
export async function gravarMembros(listaId: number, entrada: MembroEntrada[], op: Operador) {
  const invalidos: string[] = []
  const porEmail = new Map<string, MembroEntrada>()
  for (const m of entrada) {
    if (!RE_EMAIL.test(m.email)) {
      invalidos.push(m.email || '(vazio)')
      continue
    }
    porEmail.set(m.email, m)
  }
  const validos = [...porEmail.values()]
  if (!validos.length) return { adicionados: 0, atualizados: 0, invalidos }

  const db = useDb()
  const existentes = new Set(
    (
      await db
        .select({ email: listaMembros.email })
        .from(listaMembros)
        .where(and(eq(listaMembros.listaId, listaId), inArray(listaMembros.email, validos.map(v => v.email))))
    ).map(e => e.email)
  )

  for (let i = 0; i < validos.length; i += 500) {
    const parte = validos.slice(i, i + 500)
    await db
      .insert(listaMembros)
      .values(
        parte.map(m => ({
          listaId,
          email: m.email,
          nome: m.nome || null,
          empresa: m.empresa || null,
          documento: soDigitos(m.documento),
          extras: m.extras && Object.keys(m.extras).length ? m.extras : null
        }))
      )
      .onConflictDoUpdate({
        target: [listaMembros.listaId, listaMembros.email],
        set: {
          nome: sql`coalesce(excluded.nome, ${listaMembros.nome})`,
          empresa: sql`coalesce(excluded.empresa, ${listaMembros.empresa})`,
          documento: sql`coalesce(excluded.documento, ${listaMembros.documento})`,
          extras: sql`coalesce(${listaMembros.extras}, '{}'::jsonb) || coalesce(excluded.extras, '{}'::jsonb)`
        }
      })
  }
  await db.update(listas).set({ atualizadoEm: new Date(), atualizadoPorNome: op.nome }).where(eq(listas.id, listaId))
  const atualizados = validos.filter(v => existentes.has(v.email)).length
  return { adicionados: validos.length - atualizados, atualizados, invalidos }
}
