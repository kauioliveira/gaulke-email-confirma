import { verificarSmtp, smtpConfig } from '../../utils/mailer'
import { baseUrl, checarBaseUrl, alcancePublico } from '../../utils/urls'
import { lotesEmExecucao } from '../../utils/sender'
import { estadoMigrations } from '../../utils/migrations'
import { saudePainel } from '../../utils/sessao-painel'
import { resolverConta } from '../../utils/mailer'
import { chaveConfigurada } from '../../utils/cripto'
import { useDb, accounts, ticketsPainel } from '../../db'
import { eq, sql } from 'drizzle-orm'
import { estadoAntivirus } from '../../utils/antivirus'

/** Diagnostico rapido: SMTP, URL publica, workers ativos e sessao do painel. */
export default defineEventHandler(async event => {
  const c = smtpConfig()
  const smtp = await verificarSmtp()
  // qual conta responderia por um disparo agora; nao lanca, para o status
  // continuar aparecendo mesmo com a configuracao quebrada
  const conta = await resolverConta().catch(() => null)
  return {
    smtp: {
      ...smtp,
      // host/from mostrados sao os da conta em uso, e nao mais os do .env:
      // eram eles que enganavam depois que o envio passou a ter varias contas
      host: conta?.host || c.host,
      port: conta?.port || c.port,
      from: conta?.from || c.from,
      habilitado: conta ? conta.enabled : c.enabled,
      conta: conta ? { id: conta.id, nome: conta.nome } : null,
      chaveConfigurada: chaveConfigurada()
    },
    urlAcesso: {
      valor: baseUrl(),
      aviso: checarBaseUrl(),
      // resolvido no boot: URL_ACESSO apontando para IP interno
      alcance: alcancePublico()
    },
    lotesAtivos: lotesEmExecucao(),
    // acoplamento com o painel: falha aqui e silenciosa, por isso e exibida
    painel: await saudePainel(event),
    // resultado do boot: se falhou, aparece na barra do admin
    migrations: estadoMigrations(),
    // monitor da caixa: um canal que parou de ler precisa aparecer na barra
    caixa: await useDb()
      .select({
        conta: accounts.nome,
        ultimaLeituraEm: accounts.imapUltimaLeituraEm,
        erro: accounts.imapUltimoErro,
        erroEm: accounts.imapUltimoErroEm
      })
      .from(accounts)
      .where(eq(accounts.monitorarCaixa, true))
      .catch(() => []),
    // chamados no painel que nao conseguiram sair
    chamados: (
      await useDb()
        .select({
          pendentes: sql<number>`count(*) filter (where ${ticketsPainel.statusEnvio} = 'pendente')::int`,
          erros: sql<number>`count(*) filter (where ${ticketsPainel.statusEnvio} = 'erro')::int`
        })
        .from(ticketsPainel)
        .catch(() => [{ pendentes: 0, erros: 0 }])
    )[0],
    // antivirus das solicitacoes: fora do ar, os arquivos dos clientes ficam
    // presos na quarentena ate ele voltar
    antivirus: {
      ...(await estadoAntivirus()),
      quarentena:
        (
          await useDb()
            .execute<{ n: number }>(
              sql`select count(*)::int as n from sys_mail_solic_arquivos where antivirus in ('pendente', 'erro') and removido_em is null`
            )
            .catch(() => [{ n: 0 }])
        )[0]?.n ?? 0
    }
  }
})
