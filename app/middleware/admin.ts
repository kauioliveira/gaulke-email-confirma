/**
 * Protege as telas administrativas. A checagem real acontece no servidor
 * (server/middleware/admin-guard.ts); aqui e so para nao piscar a tela.
 */
export default defineNuxtRouteMiddleware(async to => {
  if (to.path === '/admin/login') return

  const { autenticado } = await $fetch<{ autenticado: boolean }>(api('/api/admin/sessao'), {
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
  }).catch(() => ({ autenticado: false }))

  if (!autenticado) {
    return navigateTo(`/admin/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }
})
