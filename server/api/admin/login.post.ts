import { z } from 'zod'
import { criarSessao, senhaConfere } from '../../utils/auth'
import { bloqueioRestante, registrarFalha, registrarSucesso } from '../../utils/login-guard'
import { lerConfig } from '../../utils/config'
import { auditar } from '../../utils/auditoria'
import { OPERADOR_SENHA_LOCAL } from '../../utils/permissoes'

const schema = z.object({ senha: z.string().min(1) })

/**
 * Login pela senha local do .env — acesso de EMERGENCIA (decisao D3).
 *
 * O caminho normal e a sessao do painel, que identifica a pessoa. Este existe
 * para quando o painel esta fora do ar, e por isso fica auditado (acertos e
 * erros) e pode ser desligado pelo admin em Configuracoes.
 */
export default defineEventHandler(async event => {
  if (!(await lerConfig('senha_local_habilitada'))) {
    throw createError({
      statusCode: 403,
      statusMessage: 'O acesso por senha local foi desligado pelo administrador. Entre pelo painel.'
    })
  }

  // Antes de olhar a senha: quem ja errou demais nem chega a ser avaliado.
  const espera = bloqueioRestante(event)
  if (espera) {
    setResponseHeader(event, 'retry-after', espera)
    throw createError({
      statusCode: 429,
      statusMessage: `Muitas tentativas. Tente novamente em ${espera}s.`
    })
  }

  const { senha } = validar(schema, await readBody(event))

  if (!senhaConfere(senha)) {
    registrarFalha(event)
    await auditar(event, 'sessao.senha_local_falhou', {
      entidade: 'sessao',
      resumo: 'Tentativa de acesso por senha local com senha incorreta',
      operador: null
    })
    // atraso fixo para nao virar oraculo de tentativa e erro
    await new Promise(r => setTimeout(r, 600))
    throw createError({ statusCode: 401, statusMessage: 'Senha incorreta' })
  }

  // acertou: o historico de falhas daquele IP deixa de existir
  registrarSucesso(event)
  criarSessao(event)
  await auditar(event, 'sessao.senha_local', {
    entidade: 'sessao',
    resumo: 'Entrou pelo acesso de emergência (senha local)',
    operador: OPERADOR_SENHA_LOCAL
  })
  return { ok: true }
})
