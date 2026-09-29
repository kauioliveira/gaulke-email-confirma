import { eq } from 'drizzle-orm'
import { useDb, certificados } from '../../../../db'
import { exigirPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'
import { certificadoParaAssinar, ErroCertificado } from '../../../../utils/certificados'
import { selarPdf } from '../../../../utils/pades'
import { DocumentoPdf } from '../../../../utils/pdf-documento'

/**
 * Teste de ponta a ponta do certificado GUARDADO: decifra a chave, assina um
 * PDF de teste com o selo PAdES e devolve o PDF — abra no Adobe Reader ou em
 * validar.iti.gov.br para ver a assinatura.
 */
export default defineEventHandler(async event => {
  const op = exigirPapel(event, 'admin', 'testar certificados')
  const id = Number(getRouterParam(event, 'id'))
  const db = useDb()
  const agora = new Date()
  try {
    const { registro, certPem, keyPem } = await certificadoParaAssinar(id)
    const doc = await DocumentoPdf.criar('Teste de assinatura digital', 'Gaulke Comunica · documento de teste, sem valor')
    doc.titulo1('Teste de assinatura digital', 'Documento gerado só para conferir o certificado. Não tem valor.')
    doc.campo('Certificado', registro.nome)
    doc.campo('Titular', registro.titular)
    doc.campo('CNPJ/CPF', registro.documento ?? '—')
    doc.campo('Emissor', registro.emissor ?? '—')
    doc.campo('Válido até', formatarDataHora(registro.validoAte))
    doc.campo('Assinado em', `${formatarDataHora(agora)} (horário de Brasília)`)
    doc.campo('Pedido por', op.nome)
    const pdf = await selarPdf(await doc.finalizar(), {
      certPem,
      keyPem,
      nome: registro.titular,
      motivo: 'Teste do certificado no Gaulke Comunica',
      local: 'Brasil'
    })
    await db
      .update(certificados)
      .set({ ultimoTesteEm: agora, ultimoTesteOk: true, ultimoTesteMsg: 'PDF de teste assinado' })
      .where(eq(certificados.id, id))
    await auditar(event, 'certificado.testar_assinatura', {
      entidade: 'certificado',
      id,
      resumo: `Assinou um PDF de teste com o certificado "${registro.nome}"`
    })
    setResponseHeaders(event, {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="teste-assinatura-${dataSP(agora)}.pdf"`,
      'cache-control': 'no-store, private'
    })
    return pdf
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.update(certificados).set({ ultimoTesteEm: agora, ultimoTesteOk: false, ultimoTesteMsg: msg }).where(eq(certificados.id, id))
    if (e instanceof ErroCertificado) throw createError({ statusCode: 422, statusMessage: msg })
    throw createError({ statusCode: 500, statusMessage: `Falha ao assinar: ${msg}` })
  }
})
