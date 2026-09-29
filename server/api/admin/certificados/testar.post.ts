import { exigirPapel } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'
import { abrirPfxDoRequest } from '../../../utils/certificado-upload'
import { resumoCertificado } from '../../../utils/certificados'

/**
 * "Testar a senha": abre o .pfx com a senha informada e mostra o que tem
 * dentro — sem gravar nada. Serve para conferir a senha antes de cadastrar.
 */
export default defineEventHandler(async event => {
  const op = exigirPapel(event, 'admin', 'cadastrar certificados')
  try {
    const { dados, nomeArquivo } = await abrirPfxDoRequest(event, op)
    await auditar(event, 'certificado.testar_senha', {
      entidade: 'certificado',
      resumo: `Testou a senha do certificado "${nomeArquivo}": confere (${dados.titular})`,
      dados: { arquivo: nomeArquivo, titular: dados.titular, fingerprint: dados.fingerprintSha256 }
    })
    return { ok: true, certificado: resumoCertificado(dados) }
  } catch (e: any) {
    if (e?.statusCode === 422) {
      await auditar(event, 'certificado.testar_senha', { entidade: 'certificado', resumo: `Teste de senha de certificado falhou: ${e.statusMessage}` })
    }
    throw e
  }
})
