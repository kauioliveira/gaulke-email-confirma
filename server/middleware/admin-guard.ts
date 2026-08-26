import { sessaoValida } from '../utils/auth'

/**
 * Protege as APIs administrativas. As rotas de tracking (/api/c/**) e o
 * login ficam de fora — sao publicas por natureza.
 */
export default defineEventHandler(event => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/admin')) return
  if (path === '/api/admin/login' || path === '/api/admin/sessao') return
  if (!sessaoValida(event)) {
    throw createError({ statusCode: 401, statusMessage: 'Nao autenticado' })
  }
})
