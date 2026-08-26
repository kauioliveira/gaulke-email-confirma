import { sessaoValida } from '../utils/auth'
import { podeOperar, temCookieDoPainel, usuarioDaSessaoPainel } from '../utils/sessao-painel'

/**
 * Protege as APIs administrativas.
 *
 * Duas credenciais sao aceitas, nesta ordem:
 *
 *  1. SESSAO DO PAINEL — o cookie gaulke_auth_session chega sozinho neste
 *     subdominio. Se corresponder a uma sessao viva de admin ou supervisor, o
 *     acesso e liberado SEM senha e passamos a saber QUEM esta operando.
 *  2. SENHA DO .env — reserva. Cobre o desenvolvimento por IP (onde o cookie
 *     nao e enviado) e o caso do painel estar fora do ar.
 *
 * As rotas de tracking (/api/c/**) e o login ficam de fora: sao publicas por
 * natureza.
 */
export default defineEventHandler(async event => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/admin')) return
  if (path === '/api/admin/login' || path === '/api/admin/sessao') return

  const usuario = await usuarioDaSessaoPainel(event)

  if (usuario) {
    if (!podeOperar(usuario)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'O envio de comunicados e restrito a administradores e supervisores.',
      })
    }
    // fica disponivel para os handlers gravarem a autoria do lote
    event.context.operador = usuario
    return
  }

  if (sessaoValida(event)) return

  // Mensagem diferente quando o cookie CHEGOU mas nao foi reconhecido: ajuda a
  // perceber que a sessao expirou (ou que o acoplamento com o painel quebrou),
  // em vez de parecer que a senha e que esta errada.
  throw createError({
    statusCode: 401,
    statusMessage: temCookieDoPainel(event)
      ? 'Sessao do painel nao reconhecida ou expirada. Entre novamente no painel, ou use a senha.'
      : 'Nao autenticado',
  })
})
