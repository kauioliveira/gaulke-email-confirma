import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { and, eq } from 'drizzle-orm'
import { useDb, solicArquivos } from '../../../../../db'
import { auditar } from '../../../../../utils/auditoria'
import { caminhoDocumento, codigoSolicitacao, disposicao } from '../../../../../utils/documentos'
import { mimeDoArquivo, TIPOS_SOLICITACAO } from '../../../../../../shared/types/tipos-arquivo'

/**
 * Um arquivo enviado pelo cliente. So pela area autenticada, e so depois do
 * antivirus: o que esta na quarentena (ou foi bloqueado) nao sai daqui.
 * `?inline=1` abre no navegador (PDF e imagem), para conferir sem baixar.
 */
export default defineEventHandler(async event => {
  const solicId = Number(getRouterParam(event, 'id'))
  const arquivoId = Number(getRouterParam(event, 'arquivoId'))
  const [a] = await useDb()
    .select()
    .from(solicArquivos)
    .where(and(eq(solicArquivos.id, arquivoId), eq(solicArquivos.solicId, solicId)))
  if (!a || a.removidoEm) throw createError({ statusCode: 404, statusMessage: 'Arquivo não encontrado' })
  if (a.antivirus !== 'limpo' && a.antivirus !== 'sem_antivirus') {
    throw createError({ statusCode: 423, statusMessage: 'O arquivo ainda está na quarentena do antivírus' })
  }
  const abs = caminhoDocumento(a.caminho)
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) throw createError({ statusCode: 404, statusMessage: 'Arquivo indisponível no servidor' })

  const mime = mimeDoArquivo(a.nomeOriginal, TIPOS_SOLICITACAO)
  // inline so para o que o navegador mostra com seguranca; o resto baixa
  const inline = getQuery(event).inline === '1' && /^(application\/pdf|image\/(png|jpeg|webp))/.test(mime)
  await auditar(event, 'solicitacao.baixar_arquivo', {
    entidade: 'solicitacao',
    id: solicId,
    resumo: `${inline ? 'Abriu' : 'Baixou'} "${a.nomeOriginal}" da ${codigoSolicitacao(solicId)}`,
    dados: { arquivoId: a.id, sha256: a.sha256 }
  })
  setResponseHeaders(event, {
    'content-type': mime,
    'content-length': info.size,
    'content-disposition': disposicao(a.nomeOriginal, inline),
    'cache-control': 'no-store, private',
    // um PDF aberto inline nao roda script da nossa origem
    'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'x-content-type-options': 'nosniff'
  })
  return sendStream(event, createReadStream(abs))
})
