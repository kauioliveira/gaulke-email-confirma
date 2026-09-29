import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb, accounts } from '../../../db'
import { contaSchema } from '../../../utils/contas'
import { cifrar } from '../../../utils/cripto'
import { exigirPapel } from '../../../utils/permissoes'
import { testarImap } from '../../../utils/caixa/monitor'

const schema = contaSchema.extend({ id: z.number().int().positive().optional() })

/**
 * Testa a LEITURA da caixa (IMAP) sem gravar nada. A caixa e aberta em modo
 * somente leitura: o teste nao marca, move nem apaga mensagem nenhuma.
 * Senha vazia na edicao = a ja gravada.
 */
export default defineEventHandler(async event => {
  exigirPapel(event, 'admin', 'testar a leitura da caixa')
  const d = validar(schema, await readBody(event))

  let senhaCifrada = d.senha ? cifrar(d.senha) : ''
  if (!senhaCifrada && d.id) {
    const [a] = await useDb().select({ s: accounts.senhaCifrada }).from(accounts).where(eq(accounts.id, d.id))
    senhaCifrada = a?.s ?? ''
  }
  if (!senhaCifrada) throw createError({ statusCode: 400, statusMessage: 'Informe a senha para testar a leitura' })

  return await testarImap({
    host: d.host,
    imapHost: d.imapHost || null,
    imapPort: d.imapPort,
    imapSecure: d.imapSecure,
    usuario: d.usuario,
    senhaCifrada,
    rejectUnauthorized: String(d.rejectUnauthorized)
  })
})
