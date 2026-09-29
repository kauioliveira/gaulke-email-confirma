import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { and, eq, sql } from 'drizzle-orm'
import { useDb, recipients, batches } from '../../../db'
import { registrarEventoDoRequest } from '../../../utils/tracking'
import { foraDaLixeira } from '../../../utils/lotes'
import { caminhoNoStorage } from '../../../utils/storage'
import { mimeDoArquivo } from '../../../../shared/types/tipos-arquivo'

/**
 * Download rastreado. O arquivo fica FORA de public/ justamente para que a
 * unica forma de baixa-lo seja passando por aqui, com token e registro.
 */
export default defineEventHandler(async event => {
  const token = getRouterParam(event, 'token') || ''

  const linha = (
    await useDb()
      .select({
        id: recipients.id,
        confirmedAt: recipients.confirmedAt,
        // anexo individual: o arquivo DESTA pessoa vale mais que o do lote. As
        // colunas vao qualificadas a mao: as duas tabelas tem arquivo_path e
        // arquivo_nome, e dentro de sql`` o drizzle pode escrever so o nome
        arquivoPath: sql<string | null>`coalesce(sys_mail_recipients.arquivo_path, sys_mail_batches.arquivo_path)`,
        arquivoNome: sql<string | null>`case when sys_mail_recipients.arquivo_path is not null
          then sys_mail_recipients.arquivo_nome else sys_mail_batches.arquivo_nome end`,
        exigirConfirmacao: batches.exigirConfirmacao
      })
      .from(recipients)
      .innerJoin(batches, eq(batches.id, recipients.batchId))
      .where(and(eq(recipients.token, token), foraDaLixeira))
  )[0]

  if (!linha) throw createError({ statusCode: 404, statusMessage: 'Link invalido ou expirado' })
  if (!linha.arquivoPath) {
    throw createError({ statusCode: 404, statusMessage: 'Nenhum arquivo vinculado a este envio' })
  }
  if (linha.exigirConfirmacao === 'true' && !linha.confirmedAt) {
    throw createError({ statusCode: 403, statusMessage: 'Confirme a leitura antes de baixar' })
  }

  const caminho = caminhoNoStorage(linha.arquivoPath)
  const info = await stat(caminho).catch(() => null)
  if (!info?.isFile()) {
    throw createError({ statusCode: 404, statusMessage: 'Arquivo indisponivel no servidor' })
  }

  await registrarEventoDoRequest(event, linha.id, 'download', { arquivo: linha.arquivoNome })

  const nomeExibido = (linha.arquivoNome || linha.arquivoPath).replace(/["\\]/g, '')
  setResponseHeaders(event, {
    /**
     * Vem da extensao do arquivo, e nao mais fixo em 'application/pdf'.
     *
     * Com o PDF como unico formato o valor fixo era inofensivo; com planilha e
     * documento, ele entregaria um .xlsx anunciado como PDF — e o Excel recusa
     * abrir. Extensao desconhecida vira octet-stream, nunca um palpite.
     */
    'content-type': mimeDoArquivo(nomeExibido),
    'content-length': info.size,
    'content-disposition': `attachment; filename="${nomeExibido}"`,
    'cache-control': 'no-store, private'
  })
  return sendStream(event, createReadStream(caminho))
})
