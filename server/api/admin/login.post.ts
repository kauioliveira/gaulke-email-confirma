import { z } from 'zod'
import { criarSessao, senhaConfere } from '../../utils/auth'

const schema = z.object({ senha: z.string().min(1) })

export default defineEventHandler(async event => {
  const { senha } = schema.parse(await readBody(event))

  if (!senhaConfere(senha)) {
    // atraso fixo para nao virar oraculo de tentativa e erro
    await new Promise(r => setTimeout(r, 600))
    throw createError({ statusCode: 401, statusMessage: 'Senha incorreta' })
  }
  criarSessao(event)
  return { ok: true }
})
