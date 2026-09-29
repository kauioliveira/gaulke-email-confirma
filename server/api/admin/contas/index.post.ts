import { useDb, accounts } from '../../../db'
import { contaSchema, contaParaTeste, valoresParaBanco, rebaixarOutrasPadrao, serializar } from '../../../utils/contas'
import { verificarConta } from '../../../utils/mailer'
import { cifrar, chaveConfigurada } from '../../../utils/cripto'
import { verificarDominio } from '../../../utils/dns-email'
import { testarImap } from '../../../utils/caixa/monitor'
import { exigirPapel } from '../../../utils/permissoes'
import { auditar } from '../../../utils/auditoria'

/**
 * Cria uma conta de envio.
 *
 * So grava se a conexao funcionar. A checagem e feita AQUI, e nao apenas na
 * tela: uma conta que nao autentica salva pelo Postman quebraria um lote
 * inteiro no meio do disparo.
 */
export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'cadastrar canais de saída')
  if (!chaveConfigurada()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'SMTP_CRYPTO_KEY nao configurada no .env — gere uma com: openssl rand -hex 32'
    })
  }

  const d = validar(contaSchema, await readBody(event))
  if (!d.senha) throw createError({ statusCode: 400, statusMessage: 'Informe a senha da conta' })

  const teste = await verificarConta(contaParaTeste(d, d.senha))
  if (!teste.ok) {
    throw createError({ statusCode: 400, statusMessage: `A conexao falhou, entao nada foi salvo: ${teste.mensagem}` })
  }

  // monitorar a caixa: a leitura tem que funcionar ANTES de salvar, senao o
  // monitor so falharia em silencio a cada 2 minutos
  if (d.monitorarCaixa) {
    const imap = await testarImap({
      host: d.host, imapHost: d.imapHost || null, imapPort: d.imapPort, imapSecure: d.imapSecure,
      usuario: d.usuario, senhaCifrada: cifrar(d.senha), rejectUnauthorized: String(d.rejectUnauthorized)
    })
    if (!imap.ok) {
      throw createError({ statusCode: 400, statusMessage: `A leitura da caixa (IMAP) falhou, então nada foi salvo: ${imap.mensagem}` })
    }
  }

  const db = useDb()
  const [criada] = await db
    .insert(accounts)
    .values({
      ...valoresParaBanco(d, cifrar(d.senha), event.context.operador?.nome ?? null),
      ultimoTesteEm: new Date(),
      ultimoTesteOk: 'true',
      ultimoTesteMsg: teste.mensagem
    })
    .returning()

  if (!criada) throw createError({ statusCode: 500, statusMessage: 'Nao foi possivel criar a conta' })
  if (d.padrao) await rebaixarOutrasPadrao(criada.id)

  await auditar(event, 'conta.criar', {
    entidade: 'conta',
    id: criada.id,
    resumo: `Cadastrou o canal de saída "${criada.nome}" (${criada.remetente})`,
    dados: serializar(criada)
  })

  return { conta: serializar(criada), teste: { ...teste, dns: await verificarDominio(criada.remetente) } }
})
