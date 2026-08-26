import { z } from 'zod'
import { criarSessao, senhaConfere } from '../../utils/auth'
import { bloqueioRestante, registrarFalha, registrarSucesso } from '../../utils/login-guard'

const schema = z.object({ senha: z.string().min(1) })

export default defineEventHandler(async event => {
  // Antes de olhar a senha: quem ja errou demais nem chega a ser avaliado.
  const espera = bloqueioRestante(event)
  if (espera) {
    setResponseHeader(event, 'retry-after', espera)
    throw createError({
      statusCode: 429,
      statusMessage: `Muitas tentativas. Tente novamente em ${espera}s.`
    })
  }

  const { senha } = schema.parse(await readBody(event))

  if (!senhaConfere(senha)) {
    registrarFalha(event)
    // atraso fixo para nao virar oraculo de tentativa e erro
    await new Promise(r => setTimeout(r, 600))
    throw createError({ statusCode: 401, statusMessage: 'Senha incorreta' })
  }

  // acertou: o historico de falhas daquele IP deixa de existir
  registrarSucesso(event)
  criarSessao(event)
  return { ok: true }
})
