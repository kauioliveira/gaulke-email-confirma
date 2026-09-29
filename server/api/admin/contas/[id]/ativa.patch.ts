import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb, accounts } from '../../../../db'
import { serializar } from '../../../../utils/contas'
import { exigirPapel } from '../../../../utils/permissoes'
import { auditar } from '../../../../utils/auditoria'

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
  const op = exigirPapel(event, 'admin', 'ativar ou desativar canais de saída')
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
      atualizadoPorNome: op.nome,
      updatedAt: new Date()
    })
    .where(eq(accounts.id, id))
    .returning()

  if (!conta) throw createError({ statusCode: 404, statusMessage: 'Conta nao encontrada' })
  await auditar(event, ativa ? 'conta.ativar' : 'conta.desativar', {
    entidade: 'conta',
    id,
    resumo: `${ativa ? 'Ativou' : 'Desativou'} o canal de saída "${conta.nome}"`
  })
  return { conta: serializar(conta) }
})
