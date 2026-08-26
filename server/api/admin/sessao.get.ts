import { sessaoValida } from '../../utils/auth'
import { podeOperar, temCookieDoPainel, usuarioDaSessaoPainel } from '../../utils/sessao-painel'

/**
 * Estado da autenticacao, para a tela decidir se pede senha.
 *
 * `origem` distingue de onde veio o acesso: pela sessao do painel (e entao
 * sabemos quem e) ou pela senha do .env (anonima). A tela de login usa isso
 * para nao pedir senha a quem ja esta logado no painel.
 */
export default defineEventHandler(async event => {
  const usuario = await usuarioDaSessaoPainel(event)

  if (usuario && podeOperar(usuario)) {
    return {
      autenticado: true,
      origem: 'painel' as const,
      usuario: { nome: usuario.nome, email: usuario.email, isAdmin: usuario.isAdmin },
    }
  }

  // Sessao valida mas sem permissao: a tela precisa dizer o motivo, senao a
  // pessoa fica tentando a senha achando que errou.
  if (usuario) {
    return {
      autenticado: false,
      origem: 'painel-sem-permissao' as const,
      usuario: { nome: usuario.nome, email: usuario.email, isAdmin: false },
    }
  }

  if (sessaoValida(event)) {
    return { autenticado: true, origem: 'senha' as const, usuario: null }
  }

  return {
    autenticado: false,
    origem: temCookieDoPainel(event) ? ('painel-invalido' as const) : ('nenhuma' as const),
    usuario: null,
  }
})
