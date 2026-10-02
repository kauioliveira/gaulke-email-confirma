import { sessaoValida } from '../../utils/auth'
import { temCookieDoPainel, usuarioDaSessaoPainel } from '../../utils/sessao-painel'
import { papelDe, OPERADOR_SENHA_LOCAL } from '../../utils/permissoes'
import { acessoEmergenciaLiberado } from '../../utils/env'

/**
 * Estado da autenticacao, para a tela decidir o que mostrar.
 *
 * `origem` distingue de onde veio o acesso: pela sessao do painel (e entao
 * sabemos quem e) ou pela senha local de emergencia. `papel` e o que a tela usa
 * para esconder acoes — a regra de verdade continua no servidor, em
 * exigirPapel(). `senhaLocal` diz se o formulario de senha deve aparecer.
 */
export default defineEventHandler(async event => {
  // liberado por ambiente (.env: ACESSO_EMERGENCIA)
  const senhaLocal = acessoEmergenciaLiberado()
  const usuario = await usuarioDaSessaoPainel(event)

  if (usuario) {
    return {
      autenticado: true,
      origem: 'painel' as const,
      senhaLocal,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: papelDe(usuario) },
    }
  }

  if (senhaLocal && sessaoValida(event)) {
    return {
      autenticado: true,
      origem: 'senha' as const,
      senhaLocal,
      usuario: {
        id: null,
        nome: OPERADOR_SENHA_LOCAL.nome,
        email: OPERADOR_SENHA_LOCAL.email,
        papel: OPERADOR_SENHA_LOCAL.papel,
      },
    }
  }

  return {
    autenticado: false,
    origem: temCookieDoPainel(event) ? ('painel-invalido' as const) : ('nenhuma' as const),
    senhaLocal,
    usuario: null,
  }
})
