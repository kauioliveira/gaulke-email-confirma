import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { caminhoDocumento } from '../../../utils/documentos'

/**
 * Primeiro passo de um documento para assinar: o PDF vai para uma area
 * temporaria e a tela recebe o numero e o tamanho das paginas (para posicionar
 * os campos). Ele so vira o "original" na criacao, na pasta do cliente.
 *
 * Recusa: nao-PDF, PDF com senha e PDF que nao abre. Avisa (sem recusar)
 * quando o PDF ja tem assinatura digital: desenhar nele invalida a anterior.
 */
const MAX = 25 * 1024 * 1024

export default defineEventHandler(async event => {
  const partes = await readMultipartFormData(event)
  const p = partes?.find(x => x.name === 'arquivo' && x.filename)
  if (!p) throw createError({ statusCode: 400, statusMessage: 'Nenhum arquivo enviado' })
  if (p.data.length > MAX) throw createError({ statusCode: 413, statusMessage: 'O PDF passa de 25 MB' })
  if (p.data.subarray(0, 5).toString('latin1') !== '%PDF-') throw createError({ statusCode: 415, statusMessage: 'Envie um arquivo PDF' })

  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(p.data, { updateMetadata: false })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/encrypt/i.test(msg)) throw createError({ statusCode: 422, statusMessage: 'O PDF está protegido por senha. Envie uma versão sem senha.' })
    throw createError({ statusCode: 422, statusMessage: 'Não foi possível abrir este PDF. Ele pode estar corrompido.' })
  }
  if (doc.isEncrypted) throw createError({ statusCode: 422, statusMessage: 'O PDF está protegido por senha. Envie uma versão sem senha.' })
  if (doc.getPageCount() > 300) throw createError({ statusCode: 422, statusMessage: 'O PDF passa de 300 páginas' })

  // faxina: temporarios esquecidos ha mais de um dia
  const dir = caminhoDocumento('assinaturas-tmp/x').slice(0, -2)
  await mkdir(dir, { recursive: true })
  for (const f of await readdir(dir)) {
    const s = await stat(`${dir}/${f}`).catch(() => null)
    if (s && Date.now() - s.mtimeMs > 86_400_000) await unlink(`${dir}/${f}`).catch(() => {})
  }

  const id = randomUUID()
  await writeFile(caminhoDocumento(`assinaturas-tmp/${id}.pdf`), p.data)
  return {
    arquivoTmp: id,
    nome: p.filename!,
    tamanho: p.data.length,
    sha256: createHash('sha256').update(p.data).digest('hex'),
    paginas: doc.getPages().map(pg => {
      const { width, height } = pg.getSize()
      return { largura: width, altura: height }
    }),
    jaAssinado: p.data.includes('/ByteRange')
  }
})
