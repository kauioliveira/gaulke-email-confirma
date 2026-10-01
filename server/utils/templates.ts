import { z } from 'zod'
import type { H3Event } from 'h3'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { useDb, templates, templateVersoes, batches, type Template } from '../db'
import { blocosSchema, faltaBotaoDeAcesso } from './blocos-schema'
import { renderizarBlocos } from './blocos'
import { temPapel, type Operador } from './permissoes'

/**
 * Regras dos templates, compartilhadas pelas rotas.
 *
 *  - TIPO: 'documento' (o cliente acessa, confirma e baixa um arquivo) exige o
 *    botao de acesso; 'comunicado' (so um aviso) nao exige.
 *  - OFICIAL: so supervisor/admin editam, arquivam ou excluem; os demais
 *    duplicam e trabalham na copia. Existe para o modelo "oficial" de um setor
 *    nao ser alterado por engano.
 *  - VERSOES: todo salvamento que muda algo guarda uma copia completa.
 */

export const TIPOS_TEMPLATE = ['documento', 'comunicado'] as const

export const templateSchema = z.object({
  nome: z.string().trim().min(1).max(160),
  assunto: z.string().trim().min(1).max(300),
  formato: z.enum(['blocos', 'html']).default('html'),
  html: z.string().optional(),
  blocos: blocosSchema.optional(),
  tipo: z.enum(TIPOS_TEMPLATE).nullish(),
  categoria: z.string().trim().max(60).nullish(),
  oficial: z.boolean().optional(),
  // setor que ve o template; null = todos, ausente = nao muda (veja setorAoSalvar)
  departamentoId: z.number().int().positive().nullish()
})
export type DadosTemplate = z.output<typeof templateSchema>

export const MSG_DOCUMENTO_SEM_BOTAO =
  'Template do tipo "documento" precisa do botão de acesso: é ele que leva o cliente ao arquivo. ' +
  'Se for só um aviso, escolha o tipo "comunicado".'

/**
 * HTML do template: em modo blocos e GERADO, nunca recebido — e isso que
 * garante a marcacao de tabelas correta para o Outlook.
 */
export function htmlDoTemplate(d: DadosTemplate) {
  const html = d.formato === 'blocos' ? renderizarBlocos(d.blocos ?? [], d.assunto) : d.html
  if (!html) throw createError({ statusCode: 400, statusMessage: 'Informe o HTML ou os blocos' })
  if (d.tipo === 'documento' && d.formato === 'blocos' && faltaBotaoDeAcesso(d.blocos ?? [])) {
    throw createError({ statusCode: 400, statusMessage: MSG_DOCUMENTO_SEM_BOTAO })
  }
  return html
}

/** Template oficial so muda na mao de supervisor/admin. */
export function exigirPodeMexer(event: H3Event, t: Pick<Template, 'oficial' | 'nome'>, acao: string) {
  if (t.oficial && !temPapel(event.context.operador, 'supervisor')) {
    throw createError({
      statusCode: 403,
      statusMessage: `"${t.nome}" é um template oficial: só supervisores e administradores podem ${acao}. Use "Duplicar" para criar o seu a partir dele.`
    })
  }
}

/** Marcar/desmarcar como oficial tambem e coisa de supervisor/admin. */
export function exigirPodeMarcarOficial(event: H3Event, novo: boolean | undefined, atual: boolean) {
  if (novo === undefined || novo === atual) return
  if (!temPapel(event.context.operador, 'supervisor')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Somente supervisores e administradores podem marcar ou desmarcar um template como oficial.'
    })
  }
}

/** Quantos lotes DISPARADOS usaram o template (rascunho nao conta). */
export async function usosDoTemplate(id: number) {
  return (
    (
      await useDb()
        .select({ n: sql<number>`count(*)::int` })
        .from(batches)
        .where(and(eq(batches.templateId, id), ne(batches.status, 'rascunho')))
    )[0]?.n ?? 0
  )
}

/**
 * Guarda uma versao do template. Nao duplica: se nada mudou desde a ultima
 * versao (salvar duas vezes seguidas), nao cria outra.
 */
export async function salvarVersao(t: Template, op: Operador | undefined) {
  const db = useDb()
  const [ultima] = await db
    .select()
    .from(templateVersoes)
    .where(eq(templateVersoes.templateId, t.id))
    .orderBy(desc(templateVersoes.versao))
    .limit(1)

  const igual =
    ultima &&
    ultima.nome === t.nome &&
    ultima.assunto === t.assunto &&
    ultima.formato === t.formato &&
    ultima.tipo === t.tipo &&
    ultima.categoria === t.categoria &&
    JSON.stringify(ultima.blocos ?? null) === JSON.stringify(t.blocos ?? null) &&
    (t.formato === 'blocos' || ultima.html === t.html)
  if (igual) return ultima.versao

  const versao = (ultima?.versao ?? 0) + 1
  await db.insert(templateVersoes).values({
    templateId: t.id,
    versao,
    nome: t.nome,
    assunto: t.assunto,
    formato: t.formato,
    blocos: (t.blocos ?? null) as never,
    html: t.html,
    tipo: t.tipo,
    categoria: t.categoria,
    salvoPorUserId: op?.id ?? null,
    salvoPorNome: op?.nome ?? null
  })
  return versao
}
