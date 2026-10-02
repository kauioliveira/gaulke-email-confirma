import { sessaoValida } from '../utils/auth'
import { temCookieDoPainel, usuarioDaSessaoPainel } from '../utils/sessao-painel'
import { operadorDoPainel, OPERADOR_SENHA_LOCAL } from '../utils/permissoes'
import { acessoEmergenciaLiberado } from '../utils/env'

/**
 * Protege as APIs administrativas e identifica QUEM esta operando.
 *
 * Duas credenciais sao aceitas, nesta ordem:
 *
 *  1. SESSAO DO PAINEL — o cookie gaulke_auth_session chega sozinho neste
 *     subdominio. Qualquer usuario ATIVO do painel entra (decisao D1): o
 *     sistema virou a plataforma de comunicacao da empresa, e nao mais uma
 *     ferramenta de admin. O PAPEL (admin, supervisor, usuario) segue junto em
 *     event.context.operador e cada rota sensivel o confere com exigirPapel().
 *  2. SENHA LOCAL DO .env — so para emergencia (decisao D3): painel fora do ar
 *     ou acesso por IP no desenvolvimento, onde o cookie nao e enviado. Opera
 *     como admin, aparece na auditoria como "Acesso por senha local" e o admin
 *     pode desliga-la em Configuracoes.
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
    event.context.operador = operadorDoPainel(usuario)
    return
  }

  if (sessaoValida(event)) {
    // ambiente sem acesso de emergencia (producao): nem uma sessao antiga
    // aberta pela senha passa — vale a cada requisicao, nao so no login
    if (!acessoEmergenciaLiberado()) {
      throw createError({
        statusCode: 401,
        statusMessage: 'O acesso por senha local não está disponível neste ambiente. Entre pelo painel.'
      })
    }
    event.context.operador = OPERADOR_SENHA_LOCAL
    return
  }

  // Mensagem diferente quando o cookie CHEGOU mas nao foi reconhecido: ajuda a
  // perceber que a sessao expirou (ou que o acoplamento com o painel quebrou),
  // em vez de parecer que a senha e que esta errada.
  throw createError({
    statusCode: 401,
    statusMessage: temCookieDoPainel(event)
      ? 'Sessao do painel nao reconhecida ou expirada. Entre novamente no painel.'
      : 'Nao autenticado',
  })
})
