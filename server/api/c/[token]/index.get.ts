import { eq } from 'drizzle-orm'
import { useDb, recipients, batches } from '../../../db'
import { registrarEventoDoRequest } from '../../../utils/tracking'

/** Dados da landing page. Registra o evento de ACESSO (sinal confiavel). */
export default defineEventHandler(async event => {
  const token = getRouterParam(event, 'token') || ''
  const db = useDb()

  const linha = (
    await db
      .select({
        id: recipients.id,
        nome: recipients.nome,
        empresa: recipients.empresa,
        codigo: recipients.codigo,
        confirmedAt: recipients.confirmedAt,
        downloadCount: recipients.downloadCount,
        arquivoNome: batches.arquivoNome,
        arquivoPath: batches.arquivoPath,
        exigirConfirmacao: batches.exigirConfirmacao,
        loteNome: batches.nome
      })
      .from(recipients)
      .innerJoin(batches, eq(batches.id, recipients.batchId))
      .where(eq(recipients.token, token))
  )[0]

  // Mensagem neutra: nao revela se o token existe ou nao
  if (!linha) {
    throw createError({ statusCode: 404, statusMessage: 'Link invalido ou expirado' })
  }

  await registrarEventoDoRequest(event, linha.id, 'acesso')

  return {
    nome: linha.nome,
    empresa: linha.empresa,
    codigo: linha.codigo,
    loteNome: linha.loteNome,
    arquivoNome: linha.arquivoNome,
    temArquivo: !!linha.arquivoPath,
    exigirConfirmacao: linha.exigirConfirmacao === 'true',
    confirmado: !!linha.confirmedAt,
    confirmadoEm: linha.confirmedAt,
    downloads: linha.downloadCount
  }
})
