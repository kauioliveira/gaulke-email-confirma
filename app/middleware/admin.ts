/**
 * Protege as telas administrativas. A checagem real acontece no servidor
 * (server/middleware/admin-guard.ts); aqui e so para nao piscar a tela.
 *
 * Tambem guarda a sessao em useSessao(), de onde o layout e as paginas leem o
 * papel, e barra paginas com papel minimo (definePageMeta({ papel: 'admin' })).
 */
export default defineNuxtRouteMiddleware(async to => {
  if (to.path === '/admin/login') return

  const sessao = await $fetch<RespostaSessao>(api('/api/admin/sessao'), {
    headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
  }).catch(() => null)

  useSessao().value = sessao

  if (!sessao?.autenticado) {
    return navigateTo(`/admin/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }

  const minimo = to.meta.papel
  if (minimo) {
    const NIVEL: Record<PapelOperador, number> = { usuario: 0, supervisor: 1, admin: 2 }
    const papel = sessao.usuario?.papel ?? 'usuario'
    if (NIVEL[papel] < NIVEL[minimo]) {
      return navigateTo({ path: '/admin/lotes', query: { semPermissao: to.path } })
    }
  }
})
