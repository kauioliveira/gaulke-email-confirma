import { createHash } from 'node:crypto'
import { mkdir, rm, rmdir, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { ParsedMail, Attachment } from 'mailparser'
import { eq } from 'drizzle-orm'
import { useDb, inbound, type AnexoRecebido } from '../../db'
import { caminhoDocumento, slugPasta } from '../documentos'
import { verificarArquivo } from '../antivirus'

/**
 * Guarda a RESPOSTA do cliente por inteiro: quem pediu nem sempre tem acesso
 * a caixa do canal, e precisa ler, baixar o que o cliente mandou e responder.
 *
 * Fica em documentos/caixa/<ano>/<inboundId>/:
 *   mensagem.eml   o original, como chegou (prova e "abrir no Outlook")
 *   01-nome.pdf    cada anexo do cliente, ja pelo antivirus
 *
 * Fora: as partes tecnicas (relatorio de entrega, recibo, o e-mail original
 * citado numa devolucao) e as imagens embutidas na assinatura (image001.png).
 */

/** acima disto o .eml nao e guardado (o texto continua) */
export const MAX_MENSAGEM = 25 * 1024 * 1024
const MAX_TEXTO = 200_000
const MAX_HTML = 1_000_000

const PARTE_TECNICA = /^(message\/(delivery-status|disposition-notification|rfc822|rfc822-headers|global(-headers|-delivery-status|-disposition-notification)?)|text\/rfc822-headers)$/i

/** Anexo de verdade: tem nome e nao e imagem embutida no corpo/assinatura. */
function anexoDoCliente(a: Attachment) {
  if (PARTE_TECNICA.test(a.contentType)) return false
  if (a.related) return false
  if (a.contentDisposition === 'inline' && a.contentId && /^image\//i.test(a.contentType)) return false
  return !!(a.filename || a.contentDisposition === 'attachment')
}

function nomeSeguro(original: string, n: number) {
  const ext = extname(original).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10)
  const base = slugPasta(original.slice(0, original.length - extname(original).length), 60)
  return `${String(n).padStart(2, '0')}-${base}${ext}`
}

const pastaDe = (id: number, quando: Date) => `caixa/${quando.getFullYear()}/${id}`

export async function guardarMensagem(id: number, m: ParsedMail, fonte: Buffer | null) {
  const pasta = pastaDe(id, m.date ?? new Date())
  const abs = caminhoDocumento(pasta)
  await mkdir(abs, { recursive: true })

  let tamanho = fonte?.length ?? 0
  if (fonte && fonte.length <= MAX_MENSAGEM) await writeFile(caminhoDocumento(`${pasta}/mensagem.eml`), fonte, { mode: 0o640 })

  const anexos: AnexoRecebido[] = []
  let n = 0
  for (const a of m.attachments ?? []) {
    if (!anexoDoCliente(a)) continue
    n++
    const nome = (a.filename || `anexo-${n}`).normalize('NFC').slice(0, 200)
    const arquivo = nomeSeguro(nome, n)
    const caminho = caminhoDocumento(`${pasta}/${arquivo}`)
    await writeFile(caminho, a.content, { mode: 0o640 })
    const av = await verificarArquivo(caminho)
    // infectado nao fica no disco: so o registro de que veio
    if (av.status === 'infectado') await rm(caminho, { force: true })
    anexos.push({
      nome,
      tipo: a.contentType || 'application/octet-stream',
      tamanho: a.size ?? a.content.length,
      arquivo,
      sha256: createHash('sha256').update(a.content).digest('hex'),
      antivirus: av.status
    })
  }

  const referencias = [
    ...(Array.isArray(m.references) ? m.references : m.references ? [m.references] : []),
    ...(m.messageId ? [m.messageId] : [])
  ].join(' ')

  await useDb()
    .update(inbound)
    .set({
      para: (Array.isArray(m.to) ? m.to.map(t => t.text).join(', ') : m.to?.text)?.slice(0, 2000) ?? null,
      referencias: referencias.slice(0, 8000) || null,
      corpoTexto: (m.text ?? '').slice(0, MAX_TEXTO) || null,
      corpoHtml: typeof m.html === 'string' ? m.html.slice(0, MAX_HTML) : null,
      pasta,
      tamanho,
      anexos: anexos.length ? anexos : null
    })
    .where(eq(inbound.id, id))
  return { pasta, anexos }
}

/**
 * Apaga a pasta de UMA mensagem guardada. So aceita caixa/<ano>/<id>: um
 * valor torto vindo do banco nao pode virar rm -rf de outra coisa.
 */
export async function apagarPastaMensagem(pasta: string | null | undefined) {
  if (!pasta) return
  if (!/^caixa\/\d{4}\/\d+$/.test(pasta)) throw new Error(`pasta da caixa fora do padrao, nao apagada: ${pasta}`)
  await rm(caminhoDocumento(pasta), { recursive: true, force: true })
  // o ano vazio sai junto
  await rmdir(caminhoDocumento(pasta.split('/').slice(0, 2).join('/'))).catch(() => {})
}
