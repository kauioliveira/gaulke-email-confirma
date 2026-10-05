import { basename } from 'node:path'
import { carregarMensagem, responderMensagem } from '../../../../utils/caixa/mensagem'
import { auditar } from '../../../../utils/auditoria'
import { tipoPelaExtensao, assinaturaConfere, TIPOS_SOLICITACAO, mimeDoArquivo } from '../../../../../shared/types/tipos-arquivo'

const MAX_ARQUIVOS = 10
const MAX_TOTAL = 20 * 1024 * 1024

/**
 * Responde o cliente pela tela do e-mail recebido (multipart: `texto` e
 * `arquivo` quantas vezes forem). Sai pelo canal que recebeu, na mesma
 * conversa, e vira comentario no chamado daquela mensagem.
 */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const l = await carregarMensagem(event, id)
  const partes = (await readMultipartFormData(event)) ?? []
  const texto = partes.find(p => p.name === 'texto' && !p.filename)?.data.toString('utf8').trim() ?? ''
  if (texto.length < 2) throw createError({ statusCode: 400, statusMessage: 'Escreva a resposta.' })
  if (texto.length > 20000) throw createError({ statusCode: 400, statusMessage: 'A resposta passa de 20 mil caracteres.' })

  const arquivos = partes.filter(p => p.name === 'arquivo' && p.filename)
  if (arquivos.length > MAX_ARQUIVOS) throw createError({ statusCode: 400, statusMessage: `No máximo ${MAX_ARQUIVOS} anexos.` })
  const total = arquivos.reduce((t, a) => t + a.data.length, 0)
  if (total > MAX_TOTAL) throw createError({ statusCode: 413, statusMessage: 'Os anexos passam de 20 MB juntos.' })
  const anexos = arquivos.map(a => {
    const nome = basename(a.filename!).normalize('NFC')
    // os mesmos formatos seguros dos anexos do sistema, com o conteudo conferido
    const tipo = tipoPelaExtensao(nome, TIPOS_SOLICITACAO)
    if (!tipo || !assinaturaConfere(a.data, tipo)) {
      throw createError({ statusCode: 415, statusMessage: `"${nome}" não é um formato aceito (PDF, imagem, Office, texto, ZIP).` })
    }
    return { nome, conteudo: a.data, tipo: mimeDoArquivo(nome, TIPOS_SOLICITACAO) }
  })

  const r = await responderMensagem(l, texto, anexos, l.op)
  await auditar(event, 'caixa.responder', {
    entidade: 'inbound',
    id,
    resumo: `Respondeu ${r.para} pelo sistema: "${r.assunto}"${anexos.length ? ` (${anexos.length} anexo(s))` : ''}`,
    dados: { para: r.para, anexos: anexos.map(a => a.nome) }
  })
  return { ok: true, ...r }
})
