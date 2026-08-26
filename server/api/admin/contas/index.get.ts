import { listarContas } from '../../../utils/contas'
import { chaveConfigurada, impressaoDaChave } from '../../../utils/cripto'
import { smtpConfig } from '../../../utils/mailer'

/** Lista as contas de envio. A senha nunca vem junto. */
export default defineEventHandler(async () => {
  const c = smtpConfig()
  return {
    contas: chaveConfigurada() ? await listarContas() : [],
    // A tela precisa explicar o que fazer em vez de so falhar ao salvar.
    chave: { configurada: chaveConfigurada(), impressao: impressaoDaChave() },
    // Referencia para quem for cadastrar: o servidor costuma ser o mesmo.
    sugestao: { host: c.host, port: c.port, secure: c.secure, requireTls: c.requireTLS }
  }
})
