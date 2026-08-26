import { eq } from 'drizzle-orm'
import { useDb, accounts } from '../../../db'
import { contaSchema, contaParaTeste, valoresParaBanco, rebaixarOutrasPadrao, serializar } from '../../../utils/contas'
import { verificarConta } from '../../../utils/mailer'
import { cifrar, decifrar } from '../../../utils/cripto'

/**
 * Edita uma conta. Senha vazia mantem a atual.
 *
 * Assim como na criacao, so grava se a conexao responder — inclusive quando se
 * mudou apenas o rotulo. E de proposito: o efeito colateral e que uma conta com
 * o servidor fora do ar nao pode ser editada, e para esse caso existe o
 * desativar, que nao testa.
 */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const d = validar(contaSchema, await readBody(event))

  const db = useDb()
  const [atual] = await db.select().from(accounts).where(eq(accounts.id, id))
  if (!atual) throw createError({ statusCode: 404, statusMessage: 'Conta nao encontrada' })

  const senha = d.senha || decifrar(atual.senhaCifrada)

  const teste = await verificarConta(contaParaTeste(d, senha))
  if (!teste.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: `A conexao falhou, entao nada foi alterado: ${teste.mensagem}`
    })
  }

  const [conta] = await db
    .update(accounts)
    .set({
      ...valoresParaBanco(d, d.senha ? cifrar(d.senha) : atual.senhaCifrada),
      ultimoTesteEm: new Date(),
      ultimoTesteOk: 'true',
      ultimoTesteMsg: teste.mensagem,
      updatedAt: new Date()
    })
    .where(eq(accounts.id, id))
    .returning()

  if (!conta) throw createError({ statusCode: 500, statusMessage: 'Nao foi possivel salvar a conta' })
  if (d.padrao) await rebaixarOutrasPadrao(conta.id)

  return { conta: serializar(conta), teste }
})
