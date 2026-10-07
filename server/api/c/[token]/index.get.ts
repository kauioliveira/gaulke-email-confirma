import { and, eq } from 'drizzle-orm'
import { useDb, recipients, batches } from '../../../db'
import { registrarEventoDoRequest } from '../../../utils/tracking'
import { foraDaLixeira } from '../../../utils/lotes'
import { camposComRespostas } from '../../../utils/lote-campos'

/** Dados da landing page. Registra o evento de ACESSO (sinal confiavel). */
export default defineEventHandler(async event => {
  const token = getRouterParam(event, 'token') || ''
  const db = useDb()

  const linha = (
    await db
      .select({
        id: recipients.id,
        batchId: recipients.batchId,
        nome: recipients.nome,
        empresa: recipients.empresa,
        codigo: recipients.codigo,
        confirmedAt: recipients.confirmedAt,
        downloadCount: recipients.downloadCount,
        arquivoNome: batches.arquivoNome,
        arquivoPath: batches.arquivoPath,
        // anexo individual: o arquivo DESTA pessoa vale mais que o do lote
        arquivoProprioNome: recipients.arquivoNome,
        arquivoProprioPath: recipients.arquivoPath,
        exigirConfirmacao: batches.exigirConfirmacao,
        loteNome: batches.nome
      })
      .from(recipients)
      .innerJoin(batches, eq(batches.id, recipients.batchId))
      // lote na lixeira responde igual a token inexistente
      .where(and(eq(recipients.token, token), foraDaLixeira))
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
    arquivoNome: linha.arquivoProprioPath ? linha.arquivoProprioNome : linha.arquivoNome,
    temArquivo: !!(linha.arquivoProprioPath || linha.arquivoPath),
    exigirConfirmacao: linha.exigirConfirmacao === 'true',
    confirmado: !!linha.confirmedAt,
    confirmadoEm: linha.confirmedAt,
    downloads: linha.downloadCount,
    // o que o cliente preenche antes de baixar (vazio = so confirmar)
    campos: await camposComRespostas(linha.batchId, linha.id)
  }
})
