import type { ValidacaoAssinatura, StatusAssinatura, StatusSignatario } from '../../shared/types/api'
import { eq, or } from 'drizzle-orm'
import { useDb, assinDocumentos, assinSignatarios } from '../db'
import { codigoAssinatura, mascararEmail } from '../utils/assinatura'

/**
 * Validacao publica: pelo codigo de verificacao da folha de assinaturas, ou
 * pelo SHA-256 de um PDF (calculado no navegador: o arquivo nao sobe). Mostra
 * so o necessario para conferir — titulo, quem assinou e quando —, com e-mails
 * mascarados. Nada de arquivo.
 */
export default defineEventHandler(async event => {
  const q = getQuery(event)
  const codigo = String(q.c || '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '')
  const hash = String(q.hash || '').trim().toLowerCase()
  if (!codigo && !/^[0-9a-f]{64}$/.test(hash)) throw createError({ statusCode: 400, statusMessage: 'Informe o código ou envie o PDF' })
  const db = useDb()
  const [d] = await db
    .select()
    .from(assinDocumentos)
    .where(codigo ? eq(assinDocumentos.codigoVerificacao, codigo) : or(eq(assinDocumentos.finalSha256, hash), eq(assinDocumentos.originalSha256, hash)))
    .limit(1)
  if (!d || d.status === 'rascunho') throw createError({ statusCode: 404, statusMessage: 'Nenhum documento encontrado' })
  const sigs = await db.select().from(assinSignatarios).where(eq(assinSignatarios.documentoId, d.id))
  const resposta: ValidacaoAssinatura = {
    codigo: codigoAssinatura(d),
    titulo: d.titulo,
    status: d.status as StatusAssinatura,
    enviadoEm: d.enviadoEm?.toISOString() ?? null,
    concluidoEm: d.concluidoEm?.toISOString() ?? null,
    paginas: d.originalPaginas,
    originalSha256: d.originalSha256,
    finalSha256: d.finalSha256,
    conferido: codigo ? 'codigo' : hash === d.finalSha256 ? 'pdf_final' : 'pdf_original',
    selado: d.assinarComoGaulke && d.status === 'concluido',
    signatarios: sigs
      .sort((a, b) => a.ordem - b.ordem)
      .map(s => ({ nome: s.nome, email: mascararEmail(s.email), status: s.status as StatusSignatario, assinadoEm: s.assinadoEm?.toISOString() ?? null }))
  }
  return resposta
})
