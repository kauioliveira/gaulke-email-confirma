import { useDb, accounts } from '../../../db'
import { contaSchema, contaParaTeste, valoresParaBanco, rebaixarOutrasPadrao, serializar } from '../../../utils/contas'
import { verificarConta } from '../../../utils/mailer'
import { cifrar, chaveConfigurada } from '../../../utils/cripto'

/**
 * Cria uma conta de envio.
 *
 * So grava se a conexao funcionar. A checagem e feita AQUI, e nao apenas na
 * tela: uma conta que nao autentica salva pelo Postman quebraria um lote
 * inteiro no meio do disparo.
 */
export default defineEventHandler(async event => {
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

  return { conta: serializar(criada), teste }
})
