import { verificarSmtp, smtpConfig } from '../../utils/mailer'
import { baseUrl, checarBaseUrl } from '../../utils/urls'
import { lotesEmExecucao } from '../../utils/sender'

/** Diagnostico rapido: SMTP, URL publica e workers ativos. */
export default defineEventHandler(async () => {
  const c = smtpConfig()
  const smtp = await verificarSmtp()
  return {
    smtp: { ...smtp, host: c.host, port: c.port, from: c.from, habilitado: c.enabled },
    urlAcesso: { valor: baseUrl(), aviso: checarBaseUrl() },
    lotesAtivos: lotesEmExecucao()
  }
})
