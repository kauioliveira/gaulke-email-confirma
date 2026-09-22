import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { caminhoNaImagem } from '../../utils/storage'
import { TIPOS_IMAGEM, mimeDoArquivo, tipoPelaExtensao } from '../../../shared/types/tipos-arquivo'

/**
 * Imagens do corpo do e-mail, servidas PUBLICAMENTE.
 *
 * Fica em server/routes/ e nao em server/api/admin/ de proposito: quem busca
 * esta imagem e o CLIENTE DE E-MAIL do destinatario, de fora, sem sessao — e
 * /api/admin/** e barrado pelo server/middleware/admin-guard.ts.
 *
 * Nao ha rastreio aqui, e nao deve haver: imagem de e-mail e carregada (ou
 * bloqueada) pelo programa de e-mail sozinho, entao contar acesso por aqui
 * daria um numero errado. Quem mede abertura e o pixel em utils/abertura.ts.
 *
 * Servir de public/ resolveria o acesso, mas public/ e assado na imagem Docker
 * e nao persiste o que for enviado pela tela — dai a leitura pelo volume.
 */
export default defineEventHandler(async event => {
  const nome = getRouterParam(event, 'nome') || ''
  if (!nome || !tipoPelaExtensao(nome, TIPOS_IMAGEM)) {
    throw createError({ statusCode: 404, statusMessage: 'Imagem nao encontrada' })
  }

  const caminho = caminhoNaImagem(nome)
  const info = await stat(caminho).catch(() => null)
  if (!info?.isFile()) {
    throw createError({ statusCode: 404, statusMessage: 'Imagem nao encontrada' })
  }

  setResponseHeaders(event, {
    'content-type': mimeDoArquivo(nome, TIPOS_IMAGEM),
    'content-length': info.size,
    // o nome ja carrega sufixo aleatorio (nomeSeguro), entao o conteudo de um
    // nome nunca muda: cache longo e seguro e poupa o servidor de uma busca
    // por destinatario a cada abertura do e-mail
    'cache-control': 'public, max-age=31536000, immutable'
  })
  return sendStream(event, createReadStream(caminho))
})
