import { randomUUID, createHash } from 'node:crypto'
import { readFile, rename, mkdir, copyFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { useDb, assinDocumentos, assinSignatarios, assinCampos, accounts } from '../../../db'
import { operadorAtual } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'
import { suprimidos } from '../../../utils/supressao'
import { caminhoDocumento } from '../../../utils/documentos'
import { certificadoParaAssinar, ErroCertificado } from '../../../utils/certificados'
import {
  criarAssinaturaSchema,
  codigoAssinatura,
  novoCodigoAssinatura,
  novoCodigoVerificacao,
  pastaDaAssinatura,
  registrarEventoAssin,
  liberarProximos
} from '../../../utils/assinatura'

/** Cria o documento, grava o original na pasta do cliente e envia os convites. */
export default defineEventHandler(async event => {
  const op = operadorAtual(event)
  const d = validar(criarAssinaturaSchema, await readBody(event))
  const db = useDb()

  const tmp = caminhoDocumento(`assinaturas-tmp/${d.arquivoTmp}.pdf`)
  const bytes = await readFile(tmp).catch(() => null)
  if (!bytes) throw createError({ statusCode: 410, statusMessage: 'O PDF enviado expirou. Envie o arquivo de novo.' })
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const paginas = pdf.getPages().map(p => p.getSize())

  const emails = d.signatarios.map(s => s.email)
  if (new Set(emails).size !== emails.length) throw createError({ statusCode: 400, statusMessage: 'O mesmo e-mail aparece duas vezes entre quem assina.' })
  const bloqueados = await suprimidos(emails)
  if (bloqueados.length) {
    throw createError({ statusCode: 400, statusMessage: `Estes e-mails devolveram antes e estão bloqueados: ${bloqueados.map(b => b.email).join(', ')}` })
  }
  for (const c of d.campos) {
    const pg = paginas[c.pagina - 1]
    if (c.signatario >= d.signatarios.length) throw createError({ statusCode: 400, statusMessage: 'Campo ligado a quem não está na lista.' })
    if (!pg || c.x + c.largura > pg.width + 1 || c.y + c.altura > pg.height + 1) {
      throw createError({ statusCode: 400, statusMessage: `Campo fora da página ${c.pagina}.` })
    }
  }

  let certificadoId: number | null = null
  if (d.assinarComoGaulke) {
    try {
      certificadoId = (await certificadoParaAssinar(d.certificadoId)).registro.id
    } catch (e) {
      if (e instanceof ErroCertificado) throw createError({ statusCode: 422, statusMessage: e.message })
      throw e
    }
  }
  let contaNome: string | null = null
  if (d.contaId) {
    const [c] = await db.select().from(accounts).where(eq(accounts.id, d.contaId))
    if (!c || c.ativa !== 'true') throw createError({ statusCode: 400, statusMessage: 'O canal escolhido não existe ou está desativado' })
    contaNome = c.nome
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const codigoPublico = await novoCodigoAssinatura()
  const docId = await db.transaction(async tx => {
    const [doc] = await tx
      .insert(assinDocumentos)
      .values({
        titulo: d.titulo,
        mensagem: d.mensagem,
        status: 'aguardando',
        ordem: d.ordem,
        assinarComoGaulke: d.assinarComoGaulke,
        certificadoId,
        prazo: d.prazo,
        clienteNome: d.clienteNome,
        clienteDocumento: d.clienteDocumento,
        originalNome: d.arquivoNome,
        originalSha256: sha256,
        originalPaginas: paginas.length,
        codigo: codigoPublico,
        codigoVerificacao: novoCodigoVerificacao(),
        contaId: d.contaId ?? null,
        contaNome,
        responderPara: d.responderPara,
        criadoPorUserId: op.id,
        criadoPorNome: op.nome,
        criadoPorEmail: op.email,
        departamentoId: op.departamentoId,
        enviadoEm: new Date()
      })
      .returning()
    const pasta = pastaDaAssinatura(doc!, d.signatarios[0]!)
    const ids: number[] = []
    for (const [i, s] of d.signatarios.entries()) {
      const [row] = await tx
        .insert(assinSignatarios)
        .values({ documentoId: doc!.id, ordem: i + 1, nome: s.nome, email: s.email, cpf: s.cpf, papel: s.papel, token: randomUUID() })
        .returning({ id: assinSignatarios.id })
      ids.push(row!.id)
    }
    if (d.campos.length) {
      await tx.insert(assinCampos).values(d.campos.map(c => ({ ...c, documentoId: doc!.id, signatarioId: ids[c.signatario]! })))
    }
    // o original sai da area temporaria para a pasta do cliente
    const originalPath = `${pasta}/${codigoAssinatura(doc!)}_original.pdf`
    const destino = caminhoDocumento(originalPath)
    await mkdir(dirname(destino), { recursive: true })
    try {
      await rename(tmp, destino)
    } catch {
      await copyFile(tmp, destino)
      await unlink(tmp).catch(() => {})
    }
    await tx.update(assinDocumentos).set({ pasta, originalPath }).where(eq(assinDocumentos.id, doc!.id))
    return doc!.id
  })

  const codigo = codigoPublico
  await registrarEventoAssin(
    docId,
    'criado',
    `Documento "${d.titulo}" (${d.arquivoNome}, ${paginas.length} página(s), SHA-256 ${sha256}) enviado para assinatura de ${d.signatarios.map(s => s.nome).join(', ')}, ordem ${d.ordem}${d.assinarComoGaulke ? ', com selo da Gaulke' : ''}`,
    { porNome: op.nome }
  )
  await auditar(event, 'assinatura.criar', {
    entidade: 'assinatura',
    id: docId,
    resumo: `Enviou "${d.titulo}" (${codigo}) para assinatura de ${d.signatarios.length} pessoa(s)`,
    dados: { titulo: d.titulo, sha256, signatarios: d.signatarios.map(s => s.email), ordem: d.ordem, selo: d.assinarComoGaulke, campos: d.campos.length }
  })

  // convites em segundo plano: a tela nao espera o SMTP
  void liberarProximos(docId, op.nome)
  return { id: docId, codigo }
})
