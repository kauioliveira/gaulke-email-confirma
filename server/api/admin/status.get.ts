import { verificarSmtp, smtpConfig } from '../../utils/mailer'
import { baseUrl, checarBaseUrl, alcancePublico } from '../../utils/urls'
import { lotesEmExecucao } from '../../utils/sender'
import { estadoMigrations } from '../../utils/migrations'

/** Diagnostico rapido: SMTP, URL publica e workers ativos. */
export default defineEventHandler(async () => {
  const c = smtpConfig()
  const smtp = await verificarSmtp()
  return {
    smtp: { ...smtp, host: c.host, port: c.port, from: c.from, habilitado: c.enabled },
    urlAcesso: {
      valor: baseUrl(),
      aviso: checarBaseUrl(),
      // resolvido no boot: URL_ACESSO apontando para IP interno
      alcance: alcancePublico()
    },
    lotesAtivos: lotesEmExecucao(),
    // resultado do boot: se falhou, aparece na barra do admin
    migrations: estadoMigrations()
  }
})
