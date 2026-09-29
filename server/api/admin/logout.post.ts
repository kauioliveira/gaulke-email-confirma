import { encerrarSessao, sessaoValida } from '../../utils/auth'
import { auditar } from '../../utils/auditoria'
import { OPERADOR_SENHA_LOCAL } from '../../utils/permissoes'

export default defineEventHandler(async event => {
  // so a sessao da senha local e nossa para encerrar; a do painel e do painel
  if (sessaoValida(event)) {
    await auditar(event, 'sessao.sair', {
      entidade: 'sessao',
      resumo: 'Saiu do acesso de emergência (senha local)',
      operador: OPERADOR_SENHA_LOCAL
    })
  }
  encerrarSessao(event)
  return { ok: true }
})
