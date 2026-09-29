import { exigirPapel } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'
import { abrirPfxDoRequest } from '../../../utils/certificado-upload'
import { gravarCertificado, resumoCertificado, ErroCertificado } from '../../../utils/certificados'

/** Cadastra o A1: chave cifrada no banco, senha descartada. Admin. */
export default defineEventHandler(async event => {
  const op = exigirPapel(event, 'admin', 'cadastrar certificados')
  const { dados, nomeArquivo, nome } = await abrirPfxDoRequest(event, op)
  if (dados.validoAte.getTime() < Date.now()) {
    throw createError({ statusCode: 422, statusMessage: `Este certificado venceu em ${formatarData(dados.validoAte)}.` })
  }
  let c
  try {
    c = await gravarCertificado(dados, {
      nome: nome || `${dados.titular} (vence ${formatarData(dados.validoAte)})`.slice(0, 120),
      nomeArquivo,
      criadoPorNome: op.nome
    })
  } catch (e) {
    if (e instanceof ErroCertificado) throw createError({ statusCode: 409, statusMessage: e.message })
    throw e
  }
  await auditar(event, 'certificado.cadastrar', {
    entidade: 'certificado',
    id: c.id,
    resumo: `Cadastrou o certificado "${c.nome}" (${c.titular}, vence em ${formatarData(c.validoAte)})`,
    dados: { titular: c.titular, documento: c.documento, emissor: c.emissor, fingerprint: c.fingerprintSha256, validoAte: c.validoAte }
  })
  return { id: c.id, certificado: resumoCertificado(c) }
})
