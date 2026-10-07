import { z } from 'zod'
import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { useDb, batchCampos, recipientRespostas, type BatchCampo } from '../db'
import { normalizarConfig, validarResposta, ehTipoItem } from '../../shared/utils/itens-solic'
import type { CampoLote, RespostaItem } from '../../shared/types/api'

/**
 * Campos da pagina de download de um lote: o que o cliente preenche antes de
 * baixar o arquivo. Tipos e regras sao os dos itens da solicitacao
 * (shared/utils/itens-solic.ts) — so nao ha "documento" (aqui o cliente
 * recebe arquivo, nao envia) nem conferencia da equipe.
 */

export const campoLoteSchema = z.object({
  tipo: z.string().refine(v => ehTipoItem(v) && v !== 'documento', { message: 'Tipo de campo inválido' }),
  titulo: z.string().trim().max(200).default(''),
  instrucao: z.string().trim().max(2000).nullish(),
  obrigatorio: z.boolean().default(true),
  config: z.record(z.unknown()).nullish()
})
export const camposLoteSchema = z.array(campoLoteSchema).max(30)

/** Confere e limpa os campos vindos da tela, antes de gravar. Lanca 400 no primeiro erro. */
export function normalizarCamposLote(campos: z.infer<typeof camposLoteSchema>) {
  return campos.map((c, i) => {
    const tipo = c.tipo as CampoLote['tipo']
    const cfg = normalizarConfig(tipo, (c.config ?? {}) as never)
    if (!cfg.ok) throw createError({ statusCode: 400, statusMessage: `Campo ${i + 1}${c.titulo ? ` (“${c.titulo}”)` : ''}: ${cfg.erro}` })
    if (tipo !== 'informativo' && !c.titulo) {
      throw createError({ statusCode: 400, statusMessage: `Dê um nome ao campo ${i + 1}: é o que o cliente vê.` })
    }
    return {
      ordem: i,
      tipo,
      titulo: c.titulo,
      instrucao: c.instrucao || null,
      obrigatorio: tipo === 'informativo' ? false : c.obrigatorio,
      config: { ...cfg.valor, conferir: undefined }
    }
  })
}

export async function gravarCamposLote(batchId: number, campos: ReturnType<typeof normalizarCamposLote>) {
  if (!campos.length) return
  await useDb().insert(batchCampos).values(campos.map(c => ({ ...c, batchId })))
}

export async function camposDoLote(batchId: number) {
  return useDb().select().from(batchCampos).where(eq(batchCampos.batchId, batchId)).orderBy(asc(batchCampos.ordem))
}

/** Campos do lote com a resposta desta pessoa, como a pagina do cliente mostra. */
export async function camposComRespostas(batchId: number, recipientId: number): Promise<CampoLote[]> {
  const campos = await camposDoLote(batchId)
  if (!campos.length) return []
  const respostas = await useDb()
    .select()
    .from(recipientRespostas)
    .where(and(eq(recipientRespostas.recipientId, recipientId), inArray(recipientRespostas.campoId, campos.map(c => c.id))))
  const porCampo = new Map(respostas.map(r => [r.campoId, r]))
  return campos.map(c => ({
    id: c.id,
    tipo: c.tipo,
    titulo: c.titulo,
    instrucao: c.instrucao,
    obrigatorio: c.obrigatorio,
    config: c.config,
    resposta: porCampo.get(c.id)?.resposta ?? null,
    respondidoEm: porCampo.get(c.id)?.respondidoEm.toISOString() ?? null
  }))
}

/** Titulos dos campos obrigatorios ainda sem resposta. Vazio = pode baixar. */
export async function obrigatoriosSemResposta(batchId: number, recipientId: number) {
  return (await camposComRespostas(batchId, recipientId)).filter(c => c.obrigatorio && !c.resposta).map(c => c.titulo)
}

/** 403 se faltar campo obrigatorio: a regra vale no servidor, nao so na tela. */
export async function exigirCamposPreenchidos(batchId: number, recipientId: number) {
  const faltam = await obrigatoriosSemResposta(batchId, recipientId)
  if (faltam.length) {
    throw createError({
      statusCode: 403,
      statusMessage: `Preencha os campos obrigatórios para liberar o documento: ${faltam.join(', ')}.`
    })
  }
}

const shaTexto = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

/**
 * Grava as respostas do cliente. O que nao passa na validacao volta em
 * `erros` (por campo) e o resto fica salvo. Resposta vazia apaga a anterior.
 */
export async function salvarRespostasLote(
  batchId: number,
  recipientId: number,
  entradas: { campoId: number; valor?: unknown }[],
  ctx: { ip: string | null; userAgent: string | null }
) {
  const campos = new Map((await camposDoLote(batchId)).map(c => [c.id, c] as [number, BatchCampo]))
  const erros: Record<number, string> = {}
  const gravar: { campoId: number; resposta: RespostaItem }[] = []
  const apagar: number[] = []

  for (const e of entradas) {
    const campo = campos.get(e.campoId)
    if (!campo) { erros[e.campoId] = 'Campo não encontrado.'; continue }
    const v = validarResposta(campo.tipo, campo.config, e.valor)
    if (!v.ok) { erros[e.campoId] = v.erro; continue }
    if (!v.resposta) { apagar.push(campo.id); continue }
    const resposta = campo.tipo === 'declaracao' ? { ...v.resposta, declaracaoSha256: shaTexto(campo.config.texto ?? '') } : v.resposta
    gravar.push({ campoId: campo.id, resposta })
  }

  const db = useDb()
  await db.transaction(async tx => {
    for (const g of gravar) {
      await tx
        .insert(recipientRespostas)
        .values({ recipientId, campoId: g.campoId, resposta: g.resposta, ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 500) ?? null })
        .onConflictDoUpdate({
          target: [recipientRespostas.recipientId, recipientRespostas.campoId],
          set: { resposta: g.resposta, respondidoEm: sql`now()`, ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 500) ?? null }
        })
    }
    if (apagar.length) {
      await tx
        .delete(recipientRespostas)
        .where(and(eq(recipientRespostas.recipientId, recipientId), inArray(recipientRespostas.campoId, apagar)))
    }
  })

  return { erros, gravadas: gravar, apagadas: apagar }
}

/** Respostas de varios destinatarios de um lote (relatorio, exportacao). */
export async function respostasDoLote(batchId: number) {
  const campos = await camposDoLote(batchId)
  if (!campos.length) return { campos, porDestinatario: new Map<number, Map<number, RespostaItem>>() }
  const linhas = await useDb()
    .select({ recipientId: recipientRespostas.recipientId, campoId: recipientRespostas.campoId, resposta: recipientRespostas.resposta })
    .from(recipientRespostas)
    .where(inArray(recipientRespostas.campoId, campos.map(c => c.id)))
  const porDestinatario = new Map<number, Map<number, RespostaItem>>()
  for (const l of linhas) {
    const m = porDestinatario.get(l.recipientId) ?? new Map()
    m.set(l.campoId, l.resposta)
    porDestinatario.set(l.recipientId, m)
  }
  return { campos, porDestinatario }
}
