import { eq } from 'drizzle-orm'
import { useDb, batches } from '../db'
import { destravarOrfaos, iniciarLote } from '../utils/sender'
import { checarBaseUrl, checarAlcancePublico } from '../utils/urls'
import { garantirTemplatePadrao } from '../utils/seed'
import { importarContaDoEnv } from '../utils/contas'
import { iniciarAgendador } from '../utils/agendador'
import { aplicarMigrations } from '../utils/migrations'

/**
 * Boot da aplicacao, em qualquer ambiente:
 *  1. aplica as migrations pendentes (idempotentes, so tabelas sys_mail_*);
 *  2. cria o template padrao e importa a conta SMTP do .env, na primeira
 *     execucao;
 *  3. retoma lotes que estavam enviando quando o processo caiu;
 *  4. liga o agendador, que avalia o que venceu durante a queda.
 */
export default defineNitroPlugin(async () => {
  const aviso = checarBaseUrl()
  if (aviso) console.warn(`[gaulke-mail] ATENCAO: ${aviso}`)

  // DNS uma vez so: avisa se URL_ACESSO aponta para a rede interna
  const alcance = await checarAlcancePublico()
  if (alcance) console.warn(`[gaulke-mail] ATENCAO: ${alcance}`)

  // Antes de qualquer consulta: sem as tabelas, tudo abaixo falharia.
  const migr = await aplicarMigrations()
  if (!migr.ok) {
    // Nao derrubamos o processo de proposito: um container em crash-loop
    // esconde o log que explica o problema. O erro fica visivel aqui e no
    // /api/admin/status, e a aplicacao sobe para poder ser diagnosticada.
    console.error(`[gaulke-mail] FALHA nas migrations: ${migr.erro}`)
    return
  }
  if (migr.aplicadas.length) {
    console.info(`[gaulke-mail] migrations aplicadas: ${migr.aplicadas.join(', ')}`)
  }

  try {
    await garantirTemplatePadrao()

    // Traz a conta do .env para o banco na primeira execucao, para ninguem
    // precisar recadastrar o que ja funcionava. Falha aqui nao pode derrubar o
    // boot: sem chave de cifra, o sistema continua enviando pelo .env.
    try {
      const conta = await importarContaDoEnv()
      if (conta) console.info(`[gaulke-mail] conta de envio importada do .env: ${conta.nome}`)
    } catch (e) {
      console.warn(
        '[gaulke-mail] nao foi possivel importar a conta do .env:',
        e instanceof Error ? e.message : e
      )
    }

    const destravados = await destravarOrfaos()
    if (destravados) {
      console.info(`[gaulke-mail] ${destravados} envio(s) travado(s) voltaram para a fila`)
    }

    const emAndamento = await useDb()
      .select({ id: batches.id, nome: batches.nome })
      .from(batches)
      .where(eq(batches.status, 'enviando'))

    for (const lote of emAndamento) {
      console.info(`[gaulke-mail] retomando lote #${lote.id} (${lote.nome})`)
      await iniciarLote(lote.id)
    }

    // depois da retomada: um lote agendado que venceu durante a queda e
    // avaliado agora, respeitando a tolerancia de atraso
    iniciarAgendador()
  } catch (e) {
    console.error('[gaulke-mail] falha ao retomar lotes:', e instanceof Error ? e.message : e)
  }
})
