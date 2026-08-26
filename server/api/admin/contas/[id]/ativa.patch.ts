import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb, accounts } from '../../../../db'
import { serializar } from '../../../../utils/contas'

const schema = z.object({ ativa: z.boolean() })

/**
 * Liga e desliga a conta SEM testar a conexao.
 *
 * E a saida para o caso em que o servidor SMTP caiu: editar exige teste, mas
 * desativar uma conta quebrada precisa funcionar justamente quando ela nao
 * responde. Reativar tambem nao testa — o teste de verdade acontece no proximo
 * salvamento ou no botao "Testar".
 */
export default defineEventHandler(async event => {
  const id = Number(getRouterParam(event, 'id'))
  const { ativa } = validar(schema, await readBody(event))

  const db = useDb()
  const [conta] = await db
    .update(accounts)
    .set({
      ativa: String(ativa),
      // uma conta desativada nao pode continuar sendo a padrao, senao o disparo
      // resolveria para ela e falharia
      ...(ativa ? {} : { padrao: 'false' }),
      updatedAt: new Date()
    })
    .where(eq(accounts.id, id))
    .returning()

  if (!conta) throw createError({ statusCode: 404, statusMessage: 'Conta nao encontrada' })
  return { conta: serializar(conta) }
})
