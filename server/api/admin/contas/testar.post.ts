import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb, accounts } from '../../../db'
import { contaSchema, contaParaTeste } from '../../../utils/contas'
import { verificarConta } from '../../../utils/mailer'
import { decifrar } from '../../../utils/cripto'

// id opcional: presente quando se testa uma conta que ja existe
const schema = contaSchema.extend({ id: z.number().int().positive().optional() })

/**
 * Testa a conexao sem gravar nada.
 *
 * Na edicao, senha vazia significa "manter a atual" — entao buscamos a senha
 * ja gravada para que o teste use exatamente o que sera usado no envio, e nao
 * uma senha em branco que falharia sem motivo.
 */
export default defineEventHandler(async event => {
  const d = validar(schema, await readBody(event))

  let senha = d.senha ?? ''
  if (!senha && d.id) {
    const [a] = await useDb().select().from(accounts).where(eq(accounts.id, d.id))
    if (a) senha = decifrar(a.senhaCifrada)
  }
  if (!senha) {
    throw createError({ statusCode: 400, statusMessage: 'Informe a senha para testar a conexao' })
  }

  return await verificarConta(contaParaTeste(d, senha))
})
